//! Measured render diagnostics; wall-clock measurements never enter reproducible exports.
use crate::{Error, Result, Workspace, control::RenderControl, export, graph, render};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::Instant;
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AnalyzeRequest {
    pub project: String,
    #[serde(default = "samples")]
    pub samples: u32,
    #[serde(default)]
    pub compare_fresh: bool,
}
fn samples() -> u32 {
    12
}
impl Workspace {
    pub fn analyze(&self, r: AnalyzeRequest) -> Result<Value> {
        if !(2..=32).contains(&r.samples) {
            return Err(Error::new(
                "INVALID_ARGUMENT",
                "Analysis requires 2..32 samples",
            ));
        }
        let project = self.read_project(&r.project)?;
        let scene = &project.scene;
        let compiled = graph::compile(scene)?;
        export::check_budget(
            scene,
            &compiled,
            r.samples as usize * if r.compare_fresh { 2 } else { 1 },
        )?;
        let start = Instant::now();
        let mut session = render::Session::new(scene, &compiled);
        let mut frames = vec![];
        let mut work = 0_u64;
        for i in 0..r.samples {
            let time = f64::from(i) * scene.simulation.duration_seconds / f64::from(r.samples);
            let sample = Instant::now();
            let frame = session.frame(time, &RenderControl::default())?;
            work = work.saturating_add(frame.stats.raster_work_units);
            if work > crate::model::MAX_RENDER_WORK {
                return Err(Error::new(
                    "LIMIT_EXCEEDED",
                    "Analysis exceeded cumulative raster budget",
                ));
            }
            frames.push(json!({"time_seconds":time,"render_ms":sample.elapsed().as_secs_f64()*1000.0,"pixel_sha256":export::hash(&frame.rgba),"stats":frame.stats}));
        }
        let empty = frames
            .iter()
            .filter(|f| f["stats"]["nontransparent_pixels"] == 0)
            .count();
        let clipped = frames
            .iter()
            .filter(|f| f["stats"]["clipped_particles"].as_u64().unwrap_or(0) > 0)
            .count();
        let steps: u64 = frames
            .iter()
            .map(|f| f["stats"]["simulation_steps"].as_u64().unwrap_or(0))
            .sum();
        let hits: u64 = frames
            .iter()
            .map(|f| f["stats"]["cache_hits"].as_u64().unwrap_or(0))
            .sum();
        let cached_ms: f64 = frames
            .iter()
            .map(|f| f["render_ms"].as_f64().unwrap_or(0.0))
            .sum();
        let baseline = if r.compare_fresh {
            let mut elapsed = 0.0;
            let mut steps = 0;
            for expected in &frames {
                let timer = Instant::now();
                let frame = render::frame(
                    scene,
                    &compiled,
                    expected["time_seconds"].as_f64().expect("sample time"),
                )?;
                elapsed += timer.elapsed().as_secs_f64() * 1000.0;
                steps += frame.stats.simulation_steps;
                work = work.saturating_add(frame.stats.raster_work_units);
                if work > crate::model::MAX_RENDER_WORK {
                    return Err(Error::new(
                        "LIMIT_EXCEEDED",
                        "Comparison exceeded cumulative raster budget",
                    ));
                }
                if export::hash(&frame.rgba)
                    != expected["pixel_sha256"].as_str().expect("pixel hash")
                {
                    return Err(Error::new(
                        "CACHE_MISMATCH",
                        "Incremental and fresh render pixels differ",
                    ));
                }
            }
            Some(
                json!({"fresh_render_ms":elapsed,"fresh_simulation_steps":steps,"pixel_parity":true,"measured_speedup":if cached_ms>0.0{elapsed/cached_ms}else{1.0}}),
            )
        } else {
            None
        };
        Ok(
            json!({"project_revision":project.revision,"samples":r.samples,"total_render_ms":cached_ms,"analysis_elapsed_ms":start.elapsed().as_secs_f64()*1000.0,"baseline":baseline,"simulation_steps":steps,"cache_hits":hits,"raster_work_units":work,"diagnostics":{"empty_samples":empty,"clipped_samples":clipped,"periodic_timeline":crate::integration::periodic(scene,&compiled),"note":"Empty or clipped samples may be intentional; inspect actual images and motion"},"frames":frames}),
        )
    }
}
