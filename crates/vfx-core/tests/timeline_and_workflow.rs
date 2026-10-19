mod common;
use common::{scene, stationary};
use serde_json::json;
use std::{
    fs,
    sync::{Arc, Mutex},
};
use vfx_core::{
    analysis::AnalyzeRequest, api::NewProject, control::RenderControl, export, graph, render,
    simulation, *,
};
fn repeating() -> Scene {
    let mut s = scene(
        NodeKind::EmitterStream {
            rate: 20.0,
            lifetime: [0.4, 0.8],
            speed: [10.0, 20.0],
            angle_degrees: [0.0, 360.0],
            origin: [32.0, 32.0],
        },
        vec![
            NodeKind::Turbulence {
                strength: 20.0,
                frequency: 0.075,
                scroll: [0.2, 0.1],
            },
            NodeKind::Timeline {
                settings: Timeline {
                    delay_seconds: 0.0,
                    duration_seconds: 1.0,
                    repeat: true,
                },
            },
        ],
    );
    s.simulation.duration_seconds = 3.0;
    s
}
#[test]
fn delayed_timelines_gate_births_and_clip_their_active_windows() {
    let s = scene(
        stationary([32.0, 32.0], 1),
        vec![NodeKind::Timeline {
            settings: Timeline {
                delay_seconds: 0.2,
                duration_seconds: 0.3,
                repeat: false,
            },
        }],
    );
    let g = graph::compile(&s).unwrap();
    assert!(simulation::snapshot(&s, &g, 0.19).unwrap().is_empty());
    assert_eq!(simulation::snapshot(&s, &g, 0.2).unwrap().len(), 1);
    assert_eq!(simulation::snapshot(&s, &g, 0.49).unwrap().len(), 1);
    assert!(simulation::snapshot(&s, &g, 0.5).unwrap().is_empty());
}
#[test]
fn repeating_timeline_carries_previous_cycle_particles_and_replays_exact_pixels() {
    let s = repeating();
    let g = graph::compile(&s).unwrap();
    assert!(vfx_core::integration::periodic(&s, &g));
    assert!(!simulation::snapshot(&s, &g, 0.0).unwrap().is_empty());
    for t in [0.0, 0.1, 0.3, 0.8] {
        assert_eq!(
            render::frame(&s, &g, t).unwrap().rgba,
            render::frame(&s, &g, t + 1.0).unwrap().rgba
        );
    }
    let mut session = render::Session::new(&s, &g);
    for t in [0.9, 1.0, 1.1, 1.9, 2.0, 2.1, 0.1] {
        assert_eq!(
            session.frame(t, &RenderControl::default()).unwrap().rgba,
            render::frame(&s, &g, t).unwrap().rgba
        );
    }
}
#[test]
fn invalid_cycle_lifetimes_tick_periods_and_duplicate_stateful_modifiers_fail() {
    for timeline in [
        Timeline {
            delay_seconds: 0.0,
            duration_seconds: 0.5,
            repeat: true,
        },
        Timeline {
            delay_seconds: 0.0,
            duration_seconds: 0.333,
            repeat: false,
        },
        Timeline {
            delay_seconds: 0.9,
            duration_seconds: 0.2,
            repeat: false,
        },
    ] {
        assert!(
            graph::compile(&scene(
                stationary([32.0, 32.0], 1),
                vec![NodeKind::Timeline { settings: timeline }]
            ))
            .is_err()
        );
    }
    let m = NodeKind::Material {
        settings: Material::default(),
    };
    assert!(graph::compile(&scene(stationary([32.0, 32.0], 1), vec![m.clone(), m])).is_err());
    let mut s = repeating();
    s.post_process.push(PostProcess::Palette {
        colors: vec![[255, 0, 0], [255, 0, 0]],
        dither: 0.0,
        alpha_levels: 256,
    });
    assert!(graph::compile(&s).is_err());
}
#[test]
fn incremental_simulation_matches_fresh_frames_and_reduces_integration_steps() {
    let mut source = stationary([12.0, 32.0], 32);
    if let NodeKind::EmitterShape { speed, .. } = &mut source {
        *speed = [20.0, 20.0];
    }
    let s = scene(
        source,
        vec![
            NodeKind::Turbulence {
                strength: 20.0,
                frequency: 0.075,
                scroll: [0.2, 0.1],
            },
            NodeKind::Trail {
                seconds: 0.5,
                max_points: 16,
                width_scale: 1.0,
            },
        ],
    );
    let g = graph::compile(&s).unwrap();
    let mut session = render::Session::new(&s, &g);
    let (mut cached, mut fresh, mut hits) = (0, 0, 0);
    for i in 0..20 {
        let time = f64::from(i) / 20.0;
        let a = session.frame(time, &RenderControl::default()).unwrap();
        let b = render::frame(&s, &g, time).unwrap();
        assert_eq!(a.rgba, b.rgba, "t={time}");
        cached += a.stats.simulation_steps;
        fresh += b.stats.simulation_steps;
        hits += a.stats.cache_hits;
    }
    assert!(hits > 0);
    assert!(cached * 4 < fresh, "cached={cached}, fresh={fresh}");
    for time in [0.2, 0.2, 0.65, 0.05] {
        assert_eq!(
            session.frame(time, &RenderControl::default()).unwrap().rgba,
            render::frame(&s, &g, time).unwrap().rgba
        );
    }
}
#[test]
fn all_bundled_recipes_are_pixel_identical_under_cached_and_fresh_scrubbing() {
    for recipe in &vfx_core::recipe::library().presets {
        let s = &recipe.scene;
        let g = graph::compile(s).unwrap();
        let mut session = render::Session::new(s, &g);
        for fraction in [0.0, 0.1, 0.3, 0.55, 0.8, 0.2, 0.65] {
            let t = fraction * s.simulation.duration_seconds;
            assert_eq!(
                session.frame(t, &RenderControl::default()).unwrap().rgba,
                render::frame(s, &g, t).unwrap().rgba,
                "{} at {t}",
                recipe.id
            );
        }
    }
}
#[test]
fn cancelling_every_export_format_cleans_staging_and_preserves_project_bytes() {
    for format in [
        ExportFormat::Sequence,
        ExportFormat::Spritesheet,
        ExportFormat::Gif,
        ExportFormat::Godot,
        ExportFormat::Unity,
    ] {
        let dir = tempfile::tempdir().unwrap();
        let w = Workspace::new(dir.path()).unwrap();
        w.new_project(serde_json::from_value::<NewProject>(json!({"path":"p.vfxproj"})).unwrap())
            .unwrap();
        let before = fs::read(dir.path().join("p.vfxproj")).unwrap();
        let events = Arc::new(Mutex::new(vec![]));
        let recorded = events.clone();
        let control = RenderControl::default();
        let flag = control.clone();
        let control = control.observe(move |event| {
            if event.phase == "rendering" && event.completed >= 3 {
                flag.cancel();
            }
            recorded.lock().unwrap().push(event);
        });
        let error = w
            .export_controlled(
                ExportRequest {
                    project: "p.vfxproj".into(),
                    out: "cancelled".into(),
                    format,
                    fps: 20,
                    gif: None,
                },
                &control,
            )
            .unwrap_err();
        assert_eq!(error.code, "CANCELLED");
        assert!(!dir.path().join("cancelled").exists());
        assert!(
            !fs::read_dir(dir.path())
                .unwrap()
                .any(|e| e.unwrap().file_type().unwrap().is_dir())
        );
        assert_eq!(fs::read(dir.path().join("p.vfxproj")).unwrap(), before);
        assert!(
            events
                .lock()
                .unwrap()
                .iter()
                .all(|event| event.phase != "complete")
        );
    }
}
#[test]
fn engine_adapters_share_exact_atlas_pixels_and_preserve_partial_last_frame_timing() {
    let dir = tempfile::tempdir().unwrap();
    let w = Workspace::new(dir.path()).unwrap();
    w.new_project(serde_json::from_value(json!({"path":"p.vfxproj"})).unwrap())
        .unwrap();
    for (format, out) in [
        (ExportFormat::Spritesheet, "png"),
        (ExportFormat::Godot, "godot"),
        (ExportFormat::Unity, "unity"),
    ] {
        w.export(ExportRequest {
            project: "p.vfxproj".into(),
            out: out.into(),
            format,
            fps: 29,
            gif: None,
        })
        .unwrap();
    }
    let original = fs::read(dir.path().join("png/atlas.png")).unwrap();
    for folder in ["godot", "unity"] {
        assert_eq!(
            original,
            fs::read(dir.path().join(folder).join("atlas.png")).unwrap()
        );
    }
    let tres = fs::read_to_string(dir.path().join("godot/effect.tres")).unwrap();
    assert_eq!(
        tres.matches("[sub_resource type=\"AtlasTexture\"").count(),
        24
    );
    assert!(tres.contains("\"duration\": 0.200000000000"));
    assert!(tres.contains("\"loop\": false"));
    let metadata: serde_json::Value =
        serde_json::from_slice(&fs::read(dir.path().join("unity/metadata.json")).unwrap()).unwrap();
    assert!(metadata["atlas_size"]["width"].as_u64().unwrap() > 64);
    assert_eq!(metadata["padding"], 1);
    for f in metadata["files"].as_array().unwrap() {
        assert_eq!(
            export::hash(
                &fs::read(dir.path().join("unity").join(f["path"].as_str().unwrap())).unwrap()
            ),
            f["sha256"].as_str().unwrap()
        );
    }
    assert!(dir.path().join("unity/Editor/VfxMakerImport.cs").is_file());
}
#[test]
fn old_engine_02_files_remain_read_only_compatible() {
    let dir = tempfile::tempdir().unwrap();
    let w = Workspace::new(dir.path()).unwrap();
    let mut p = Project::new(scene(stationary([32.0, 32.0], 1), vec![]));
    p.engine_version = "0.2.0".into();
    let bytes = serde_json::to_vec(&p).unwrap();
    fs::write(dir.path().join("old.vfxproj"), &bytes).unwrap();
    w.preview(PreviewRequest {
        project: "old.vfxproj".into(),
        times: vec![0.2],
    })
    .unwrap();
    assert_eq!(fs::read(dir.path().join("old.vfxproj")).unwrap(), bytes);
}
#[test]
fn analysis_reports_actual_pixels_clipping_and_cache_without_changing_the_project() {
    let dir = tempfile::tempdir().unwrap();
    let w = Workspace::new(dir.path()).unwrap();
    let s = scene(stationary([-0.5, 32.0], 1), vec![]);
    let g = graph::compile(&s).unwrap();
    let bytes = serde_json::to_vec(&Project::new(s.clone())).unwrap();
    fs::write(dir.path().join("p.vfxproj"), &bytes).unwrap();
    let result = w
        .analyze(AnalyzeRequest {
            project: "p.vfxproj".into(),
            samples: 12,
            compare_fresh: true,
        })
        .unwrap();
    assert_eq!(result["diagnostics"]["clipped_samples"], 12);
    assert_eq!(result["baseline"]["pixel_parity"], true);
    assert!(result["cache_hits"].as_u64().unwrap() > 0);
    for frame in result["frames"].as_array().unwrap() {
        let actual = render::frame(&s, &g, frame["time_seconds"].as_f64().unwrap()).unwrap();
        assert_eq!(frame["pixel_sha256"], export::hash(&actual.rgba));
    }
    assert_eq!(fs::read(dir.path().join("p.vfxproj")).unwrap(), bytes);
    assert!(
        w.analyze(AnalyzeRequest {
            project: "p.vfxproj".into(),
            samples: 1,
            compare_fresh: false
        })
        .is_err()
    );
}
