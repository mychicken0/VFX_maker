use crate::control::RenderControl;
use crate::{
    Error, Result,
    graph::{self, Compiled},
    model::*,
    render::{self, FrameStats},
    storage::Workspace,
};
use serde_json::{Value, json};
fn is_atlas(format: ExportFormat) -> bool {
    matches!(
        format,
        ExportFormat::Spritesheet | ExportFormat::Godot | ExportFormat::Unity
    )
}
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn actual_budget(total: &mut u64, work: u64) -> Result<()> {
    *total = total.saturating_add(work);
    if *total > MAX_RENDER_WORK {
        return Err(Error::new(
            "LIMIT_EXCEEDED",
            "Actual raster work exceeded the request budget; reduce frames, trail length, width or particles",
        ));
    }
    Ok(())
}

pub fn check_budget(scene: &Scene, graph: &Compiled, frames: usize) -> Result<()> {
    let mut work = 0.0;
    for p in &graph.pipelines {
        let births = match p.emitter.kind {
            NodeKind::EmitterBurst { count, .. }
            | NodeKind::EmitterPath { count, .. }
            | NodeKind::EmitterShape { count, .. } => f64::from(count),
            NodeKind::EmitterStream { rate, .. } => {
                (rate * scene.simulation.duration_seconds).ceil()
            }
            _ => 0.0,
        };
        let radius = p
            .modifiers
            .iter()
            .filter_map(|n| match n {
                NodeKind::SizeOverLife { start, end } => Some(start.max(*end)),
                NodeKind::SizeCurve { curve } => {
                    Some(curve.keys.iter().map(|k| k.value).fold(0.0, f64::max))
                }
                _ => None,
            })
            .next_back()
            .unwrap_or(1.0);
        work += births
            * (scene.simulation.duration_seconds
                * f64::from(scene.simulation.tick_hz)
                * (1 + p.modifiers.len()) as f64
                + (2.0 * radius + 3.0).powi(2));
        if let NodeKind::EmitterPath { ref points, .. } = p.emitter.kind {
            work += births * points.len() as f64 * 2.0;
        }
    }
    work += crate::post::work(
        &scene.post_process,
        u64::from(scene.canvas.width) * u64::from(scene.canvas.height),
    ) as f64;
    if graph.glow.is_some() {
        work += f64::from(scene.canvas.width) * f64::from(scene.canvas.height) * 16.0;
    }
    if work * frames as f64 > MAX_RENDER_WORK as f64 {
        return Err(Error::new(
            "LIMIT_EXCEEDED",
            "Render work budget exceeded; reduce particles, radius, duration, tick_hz or frame count",
        ));
    }
    Ok(())
}

pub struct Preview {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub frames: Vec<FrameStats>,
}
impl Preview {
    pub fn metadata(&self) -> Value {
        json!({"width":self.width,"height":self.height,"frames":self.frames,"png_sha256":hash(&self.png),"backend":BACKEND})
    }
}

pub fn preview(project: &Project, times: &[f64]) -> Result<Preview> {
    if times.is_empty() || times.len() > 8 {
        return Err(Error::new("LIMIT_EXCEEDED", "Preview requires 1..=8 times"));
    }
    let scene = &project.scene;
    let graph = graph::compile(scene)?;
    check_budget(scene, &graph, times.len())?;
    let cols = (times.len() as u32).min(4);
    let rows = (times.len() as u32).div_ceil(cols);
    let (width, height) = (scene.canvas.width * cols, scene.canvas.height * rows);
    let mut pixels = vec![0; (width * height * 4) as usize];
    let mut stats = vec![];
    let mut work = 0;
    let mut session = render::Session::new(scene, &graph);
    for (index, time) in times.iter().enumerate() {
        let frame = session.frame(*time, &RenderControl::default())?;
        actual_budget(&mut work, frame.stats.raster_work_units)?;
        blit(
            &mut pixels,
            width,
            &frame.rgba,
            frame.width,
            frame.height,
            (index as u32 % cols) * frame.width,
            (index as u32 / cols) * frame.height,
        );
        stats.push(frame.stats);
    }
    Ok(Preview {
        png: render::png_bytes(width, height, &pixels)?,
        width,
        height,
        frames: stats,
    })
}

fn blit(dest: &mut [u8], width: u32, source: &[u8], sw: u32, sh: u32, x: u32, y: u32) {
    for row in 0..sh {
        let d = (((y + row) * width + x) * 4) as usize;
        let s = (row * sw * 4) as usize;
        dest[d..d + (sw * 4) as usize].copy_from_slice(&source[s..s + (sw * 4) as usize]);
    }
}

pub fn export(workspace: &Workspace, project: &Project, request: &ExportRequest) -> Result<Value> {
    export_controlled(workspace, project, request, &RenderControl::default())
}
pub fn export_controlled(
    workspace: &Workspace,
    project: &Project,
    request: &ExportRequest,
    control: &RenderControl,
) -> Result<Value> {
    control.check()?;
    if request.gif.is_some() && !matches!(request.format, ExportFormat::Gif) {
        return Err(Error::new(
            "INVALID_ARGUMENT",
            "GIF settings apply only to GIF exports",
        ));
    }
    if !(1..=60).contains(&request.fps) {
        return Err(Error::new("INVALID_ARGUMENT", "fps must be 1..=60"));
    }
    let scene = &project.scene;
    let count = (scene.simulation.duration_seconds * f64::from(request.fps) - 1e-9).ceil() as u32;
    let pixels = u64::from(scene.canvas.width) * u64::from(scene.canvas.height) * u64::from(count);
    if count > 300 || pixels > 32 * 1024 * 1024 {
        return Err(Error::new(
            "LIMIT_EXCEEDED",
            "Export limited to 300 frames and 32 Mi pixels",
        ));
    }
    let graph = graph::compile(scene)?;
    check_budget(scene, &graph, count as usize)?;
    if matches!(request.format, ExportFormat::Gif) {
        return export_gif(workspace, project, request, &graph, count, control);
    }
    let target = workspace.resolve(&request.out)?;
    let _lock = workspace.lock(&target)?;
    if target.exists() {
        return Err(Error::new(
            "ALREADY_EXISTS",
            "Export directory exists; choose a new output path",
        ));
    }
    let staging = tempfile::tempdir_in(target.parent().unwrap())?;
    let (w, h) = (scene.canvas.width, scene.canvas.height);
    // One transparent pixel on every side prevents cross-cell texture bleeding.
    let cols = (f64::from(count).sqrt().ceil() as u32).max(1);
    let rows = count.div_ceil(cols);
    let (atlas_w, atlas_h) = ((w + 2) * cols, (h + 2) * rows);
    if is_atlas(request.format) && u64::from(atlas_w) * u64::from(atlas_h) > 32 * 1024 * 1024 {
        return Err(Error::new(
            "LIMIT_EXCEEDED",
            "Padded atlas exceeds 32 Mi pixels",
        ));
    }
    if matches!(request.format, ExportFormat::Godot | ExportFormat::Unity)
        && (atlas_w > 8192 || atlas_h > 8192)
    {
        return Err(Error::new(
            "LIMIT_EXCEEDED",
            "Engine atlas side exceeds 8192 pixels",
        ));
    }
    let mut atlas = if is_atlas(request.format) {
        vec![0; (atlas_w * atlas_h * 4) as usize]
    } else {
        vec![]
    };
    let mut frames = vec![];
    let mut files = vec![];
    let mut work = 0;
    let mut session = render::Session::new(scene, &graph);
    control.progress("rendering", 0, count);
    for index in 0..count {
        control.check()?;
        let t = f64::from(index) / f64::from(request.fps);
        let frame = session.frame(t, control)?;
        actual_budget(&mut work, frame.stats.raster_work_units)?;
        let (file, rect) = match request.format {
            ExportFormat::Sequence => {
                let file = format!("frame_{index:04}.png");
                let bytes = render::png_bytes(w, h, &frame.rgba)?;
                write(&staging.path().join(&file), &bytes)?;
                files.push(json!({"path":file,"bytes":bytes.len(),"sha256":hash(&bytes)}));
                (file, [0, 0, w, h])
            }
            ExportFormat::Spritesheet | ExportFormat::Godot | ExportFormat::Unity => {
                let (x, y) = ((index % cols) * (w + 2) + 1, (index / cols) * (h + 2) + 1);
                blit(&mut atlas, atlas_w, &frame.rgba, w, h, x, y);
                ("atlas.png".into(), [x, y, w, h])
            }
            ExportFormat::Gif => unreachable!("GIF export dispatched before PNG encoding"),
        };
        let duration = (scene.simulation.duration_seconds - t).min(1.0 / f64::from(request.fps));
        frames.push(json!({"index":index,"file":file,"rect":{"x":rect[0],"y":rect[1],"width":rect[2],"height":rect[3]},"time_seconds":t,"duration_ms":duration*1000.0,"pixel_sha256":hash(&frame.rgba),"stats":frame.stats}));
        control.progress("rendering", index + 1, count);
    }
    control.progress("encoding", count, count);
    if is_atlas(request.format) {
        let bytes = render::png_bytes(atlas_w, atlas_h, &atlas)?;
        write(&staging.path().join("atlas.png"), &bytes)?;
        files.push(json!({"path":"atlas.png","bytes":bytes.len(),"sha256":hash(&bytes)}));
    }
    for (name, bytes) in crate::integration::files(
        request.format,
        &frames,
        request.fps,
        crate::integration::periodic(scene, &graph),
    ) {
        let path = staging.path().join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        write(&path, &bytes)?;
        files.push(json!({"path":name,"bytes":bytes.len(),"sha256":hash(&bytes)}));
    }
    let mut metadata = manifest(project, request, &graph, &frames, &files)?;
    if is_atlas(request.format) {
        metadata["atlas_size"] = json!({"width":atlas_w,"height":atlas_h});
    }
    write(
        &staging.path().join("metadata.json"),
        &serde_json::to_vec_pretty(&metadata)?,
    )?;
    control.check()?;
    fs::rename(staging.path(), &target)?;
    control.progress("complete", count, count);
    Ok(
        json!({"out":target,"frame_count":count,"metadata":"metadata.json","files":files,"backend":BACKEND,"project_revision":project.revision}),
    )
}

fn write(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    let mut file = fs::File::create(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

fn export_gif(
    workspace: &Workspace,
    project: &Project,
    request: &ExportRequest,
    graph: &Compiled,
    count: u32,
    control: &RenderControl,
) -> Result<Value> {
    let settings = request.gif.clone().unwrap_or_default();
    if !(1..=8).contains(&settings.scale) || !(1..=30).contains(&settings.quantizer_speed) {
        return Err(Error::new(
            "INVALID_ARGUMENT",
            "GIF scale must be 1..=8 and quantizer_speed 1..=30",
        ));
    }
    let scene = &project.scene;
    let (w, h) = (
        scene.canvas.width * settings.scale,
        scene.canvas.height * settings.scale,
    );
    if u64::from(w) * u64::from(h) * u64::from(count) > 32 * 1024 * 1024 {
        return Err(Error::new(
            "LIMIT_EXCEEDED",
            "Scaled GIF exceeds 32 Mi output pixels; reduce scale, dimensions or frames",
        ));
    }
    let target = workspace.resolve(&request.out)?;
    let _lock = workspace.lock(&target)?;
    if target.exists() {
        return Err(Error::new(
            "ALREADY_EXISTS",
            "Export directory exists; choose a new output path",
        ));
    }
    let staging = tempfile::tempdir_in(target.parent().unwrap())?;
    let file = fs::File::create(staging.path().join("animation.gif"))?;
    let mut encoder = gif::Encoder::new(file, w as u16, h as u16, &[])?;
    if settings.repeat {
        encoder.set_repeat(gif::Repeat::Infinite)?;
    }
    let mut frames = vec![];
    let mut end_cs = 0_u16;
    let mut work = 0;
    let mut session = render::Session::new(scene, graph);
    control.progress("rendering", 0, count);
    for index in 0..count {
        let t = f64::from(index) / f64::from(request.fps);
        control.check()?;
        let frame = session.frame(t, control)?;
        actual_budget(&mut work, frame.stats.raster_work_units)?;
        let opaque = render::matte(&frame.rgba, settings.background);
        let mut scaled = vec![0; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let from =
                    (((y / settings.scale) * scene.canvas.width + x / settings.scale) * 4) as usize;
                let to = ((y * w + x) * 4) as usize;
                scaled[to..to + 4].copy_from_slice(&opaque[from..from + 4]);
            }
        }
        let next_cs = ((f64::from(index + 1) / f64::from(request.fps))
            .min(scene.simulation.duration_seconds)
            * 100.0)
            .round() as u16;
        let delay = next_cs.saturating_sub(end_cs).max(1);
        end_cs += delay;
        let mut encoded = gif::Frame::from_rgba_speed(
            w as u16,
            h as u16,
            &mut scaled,
            i32::from(settings.quantizer_speed),
        );
        encoded.delay = delay;
        encoded.dispose = gif::DisposalMethod::Keep;
        encoder.write_frame(&encoded)?;
        frames.push(json!({"index":index,"file":"animation.gif","rect":{"x":0,"y":0,"width":w,"height":h},"time_seconds":t,"duration_ms":u32::from(delay)*10,"pixel_sha256":hash(&frame.rgba),"stats":frame.stats}));
        control.progress("rendering", index + 1, count);
    }
    encoder.into_inner()?.sync_all()?;
    let bytes = fs::read(staging.path().join("animation.gif"))?;
    let files = vec![json!({"path":"animation.gif","bytes":bytes.len(),"sha256":hash(&bytes)})];
    let mut metadata = manifest(project, request, graph, &frames, &files)?;
    metadata["gif"] = json!(settings);
    metadata["output_canvas_size"] = json!({"width":w,"height":h});
    metadata["encoded_duration_seconds"] = json!(f64::from(end_cs) / 100.0);
    metadata["pixel_hash_stage"] =
        json!("native RGBA before matte, scaling and palette quantization");
    metadata["alpha_preserved"] = json!(false);
    write(
        &staging.path().join("metadata.json"),
        &serde_json::to_vec_pretty(&metadata)?,
    )?;
    control.check()?;
    fs::rename(staging.path(), &target)?;
    control.progress("complete", count, count);
    Ok(
        json!({"out":target,"frame_count":count,"metadata":"metadata.json","files":files,"backend":BACKEND,"project_revision":project.revision}),
    )
}

fn manifest(
    project: &Project,
    request: &ExportRequest,
    graph: &Compiled,
    frames: &[Value],
    files: &[Value],
) -> Result<Value> {
    let scene = &project.scene;
    let (w, h) = (scene.canvas.width, scene.canvas.height);
    Ok(
        json!({"format":"vfxmaker.export","schema_version":1,"engine_version":ENGINE_VERSION,"backend":BACKEND,"project_revision":project.revision,"scene_sha256":hash(&serde_json::to_vec(scene)?),"seed":scene.simulation.seed,"tick_hz":scene.simulation.tick_hz,"fps":request.fps,"duration_seconds":scene.simulation.duration_seconds,"sampling":"t=i/fps, i=0..ceil(duration*fps)-1; simulation samples floor(t*tick_hz)","canvas_size":{"width":w,"height":h},"pivot":{"x":0.5,"y":0.5},"origin":"top_left","trim":false,"loop":crate::integration::periodic(scene,graph),"premultiplied_alpha":false,"color_space":"sRGB","blend_mode":graph.blend,"texture_filter":if scene.canvas.pixel_mode {"nearest"} else {"linear"},"padding":if is_atlas(request.format) {1} else {0},"export_format":request.format,"frames":frames,"files":files}),
    )
}
