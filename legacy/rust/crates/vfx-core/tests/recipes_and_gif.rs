use serde_json::json;
use std::{collections::BTreeSet, fs, io::Cursor};
use vfx_core::{recipe, *};

fn request(value: serde_json::Value) -> NewProject {
    serde_json::from_value(value).unwrap()
}
fn workspace() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().unwrap();
    let w = Workspace::new(dir.path()).unwrap();
    (dir, w)
}

#[test]
fn every_bundled_recipe_is_valid_unique_and_renders_nonempty_pixels() {
    let lib = recipe::library();
    assert_eq!(lib.format, "vfxmaker.recipe_library");
    assert_eq!(lib.schema_version, 1);
    assert!(recipe::builtin(&lib.default_preset).is_ok());
    assert!(lib.presets.len() >= 12);
    let mut ids = BTreeSet::new();
    for r in &lib.presets {
        assert!(ids.insert(&r.id));
        recipe::validate(r).unwrap_or_else(|e| panic!("{}: {e}", r.id));
        let scene=recipe::instantiate(r,&request(json!({"path":"unused.vfxproj","width":r.scene.canvas.width,"height":r.scene.canvas.height,"pixel_mode":r.scene.canvas.pixel_mode}))).unwrap();
        let duration = scene.simulation.duration_seconds;
        let p = export::preview(
            &Project::new(scene),
            &[duration * 0.2, duration * 0.4, duration * 0.65],
        )
        .unwrap();
        assert!(
            p.frames.iter().any(|f| f.nontransparent_pixels > 0),
            "{} rendered only empty frames",
            r.id
        );
    }
}

#[test]
fn custom_recipe_files_and_declared_parameters_work_without_engine_branches() {
    let (dir, w) = workspace();
    let mut custom = recipe::builtin("spark_burst").unwrap().clone();
    custom.id = "external_custom_effect".into();
    custom.scene.name = "A file-authored recipe".into();
    fs::write(
        dir.path().join("custom.json"),
        serde_json::to_vec_pretty(&custom).unwrap(),
    )
    .unwrap();
    let result=w.new_project(request(json!({"path":"custom.vfxproj","preset_file":"custom.json","params":{"count":7,"size":3.5,"color":[255,0,80,255]}}))).unwrap();
    assert_eq!(result["scene"]["name"], "A file-authored recipe");
    let p = w.read_project("custom.vfxproj").unwrap();
    assert!(matches!(
        p.scene.nodes[0].kind,
        NodeKind::EmitterBurst { count: 7, .. }
    ));
    assert!(
        p.scene
            .nodes
            .iter()
            .any(|n| matches!(n.kind, NodeKind::SizeOverLife { start: 3.5, .. }))
    );
    assert!(p.scene.nodes.iter().any(|n| matches!(
        n.kind,
        NodeKind::ColorOverLife {
            start: [255, 0, 80, 255],
            ..
        }
    )));
}

#[test]
fn unknown_invalid_or_escaping_recipe_inputs_never_create_a_project() {
    let (dir, w) = workspace();
    for (params, code) in [
        (json!({"not_a_parameter":1}), "UNKNOWN_PARAMETER"),
        (json!({"size":400}), "INVALID_PARAMETER"),
        (json!({"color":[-1,0,0,255]}), "INVALID_PARAMETER"),
        (json!({"count":1.5}), "INVALID_PARAMETER"),
    ] {
        assert_eq!(
            w.new_project(request(json!({"path":"bad.vfxproj","params":params})))
                .unwrap_err()
                .code,
            code
        );
        assert!(!dir.path().join("bad.vfxproj").exists());
    }
    assert_eq!(
        w.new_project(request(
            json!({"path":"bad.vfxproj","preset_file":"../outside.json"})
        ))
        .unwrap_err()
        .code,
        "PATH_OUTSIDE_ROOT"
    );
    let mut custom = recipe::builtin("spark_burst").unwrap().clone();
    custom.parameters.get_mut("size").unwrap().targets[0].property = "/missing".into();
    assert_eq!(
        recipe::validate(&custom).unwrap_err().code,
        "INVALID_RECIPE"
    );
}

#[test]
fn generic_canvas_scaling_precedes_explicit_output_unit_overrides() {
    let r = recipe::builtin("spark_burst").unwrap();
    let s=recipe::instantiate(r,&request(json!({"path":"unused","width":128,"height":96,"params":{"size":3.5},"duration_seconds":0.9}))).unwrap();
    assert_eq!(s.canvas.width, 128);
    assert_eq!(s.simulation.duration_seconds, 0.9);
    assert!(s.nodes.iter().any(|n| matches!(
        n.kind,
        NodeKind::EmitterBurst {
            origin: [64.0, 48.0],
            speed: [37.5, 112.5],
            ..
        }
    )));
    assert!(
        s.nodes
            .iter()
            .any(|n| matches!(n.kind, NodeKind::SizeOverLife { start: 3.5, .. }))
    );
}

#[test]
fn gif_encoding_replays_frames_timing_matte_scaling_and_is_byte_reproducible() {
    let (dir, w) = workspace();
    w.new_project(request(json!({"path":"spark.vfxproj"})))
        .unwrap();
    for out in ["first", "second"] {
        w.export(ExportRequest {
            project: "spark.vfxproj".into(),
            out: out.into(),
            format: ExportFormat::Gif,
            fps: 25,
            gif: Some(GifSettings {
                scale: 2,
                background: [17, 9, 22],
                repeat: true,
                quantizer_speed: 10,
            }),
        })
        .unwrap();
    }
    let bytes = fs::read(dir.path().join("first/animation.gif")).unwrap();
    assert_eq!(
        bytes,
        fs::read(dir.path().join("second/animation.gif")).unwrap()
    );
    assert!(bytes.starts_with(b"GIF89a"));
    assert_eq!(bytes.last(), Some(&0x3b));
    let mut options = gif::DecodeOptions::new();
    options.set_color_output(gif::ColorOutput::RGBA);
    let mut reader = options.read_info(Cursor::new(&bytes)).unwrap();
    assert_eq!((reader.width(), reader.height()), (128, 128));
    let mut count = 0;
    let mut delay = 0_u32;
    let mut last = vec![];
    while let Some(frame) = reader.read_next_frame().unwrap() {
        assert_eq!((frame.width, frame.height), (128, 128));
        assert_eq!(frame.delay, 4);
        delay += u32::from(frame.delay);
        assert!(frame.buffer.as_chunks::<4>().0.iter().all(|p| p[3] == 255));
        if count == 0 {
            assert_eq!(&frame.buffer[..4], &[17, 9, 22, 255]);
            for y in (0..128).step_by(2) {
                for x in (0..128).step_by(2) {
                    let p = (y * 128 + x) * 4;
                    assert_eq!(&frame.buffer[p..p + 4], &frame.buffer[p + 4..p + 8]);
                }
            }
        }
        last = frame.buffer.to_vec();
        count += 1;
    }
    assert_eq!(count, 20);
    assert_eq!(delay, 80);
    assert!(
        last.as_chunks::<4>()
            .0
            .iter()
            .all(|p| *p == [17, 9, 22, 255])
    );
    let metadata: serde_json::Value =
        serde_json::from_slice(&fs::read(dir.path().join("first/metadata.json")).unwrap()).unwrap();
    assert_eq!(metadata["encoded_duration_seconds"], 0.8);
    assert_eq!(metadata["alpha_preserved"], false);
    assert_eq!(metadata["frames"].as_array().unwrap().len(), 20);
}

#[test]
fn fractional_frame_rates_round_cumulative_gif_time_without_drift() {
    let (dir, w) = workspace();
    w.new_project(request(json!({"path":"spark.vfxproj"})))
        .unwrap();
    w.export(ExportRequest {
        project: "spark.vfxproj".into(),
        out: "fractional".into(),
        format: ExportFormat::Gif,
        fps: 29,
        gif: None,
    })
    .unwrap();
    let mut reader = gif::DecodeOptions::new()
        .read_info(Cursor::new(
            fs::read(dir.path().join("fractional/animation.gif")).unwrap(),
        ))
        .unwrap();
    let mut delay = 0;
    let mut count = 0;
    while let Some(frame) = reader.read_next_frame().unwrap() {
        assert!(frame.delay >= 1);
        delay += u32::from(frame.delay);
        count += 1;
    }
    assert_eq!(count, 24);
    assert_eq!(delay, 80);
}

#[test]
fn invalid_gif_settings_and_scaled_output_budgets_fail_before_publication() {
    let (dir, w) = workspace();
    w.new_project(request(json!({"path":"spark.vfxproj"})))
        .unwrap();
    for settings in [
        GifSettings {
            scale: 9,
            ..Default::default()
        },
        GifSettings {
            quantizer_speed: 0,
            ..Default::default()
        },
    ] {
        let error = w
            .export(ExportRequest {
                project: "spark.vfxproj".into(),
                out: "bad".into(),
                format: ExportFormat::Gif,
                fps: 20,
                gif: Some(settings),
            })
            .unwrap_err();
        assert_eq!(error.code, "INVALID_ARGUMENT");
        assert!(!dir.path().join("bad").exists());
    }
    w.new_project(request(
        json!({"path":"large.vfxproj","width":512,"height":512}),
    ))
    .unwrap();
    let error = w
        .export(ExportRequest {
            project: "large.vfxproj".into(),
            out: "too-large".into(),
            format: ExportFormat::Gif,
            fps: 20,
            gif: Some(GifSettings {
                scale: 4,
                ..Default::default()
            }),
        })
        .unwrap_err();
    assert_eq!(error.code, "LIMIT_EXCEEDED");
    assert!(!dir.path().join("too-large").exists());
}

#[test]
fn legacy_projects_read_without_rewrite_and_upgrade_only_on_committed_mutation() {
    let (dir, w) = workspace();
    w.new_project(request(json!({"path":"legacy.vfxproj"})))
        .unwrap();
    let path = dir.path().join("legacy.vfxproj");
    let mut p = w.read_project("legacy.vfxproj").unwrap();
    p.engine_version = "0.1.0".into();
    fs::write(&path, serde_json::to_vec(&p).unwrap()).unwrap();
    let before = fs::read(&path).unwrap();
    assert_eq!(
        w.inspect("legacy.vfxproj").unwrap()["engine_version"],
        "0.1.0"
    );
    w.preview(PreviewRequest {
        project: "legacy.vfxproj".into(),
        times: vec![0.2],
    })
    .unwrap();
    w.export(ExportRequest {
        project: "legacy.vfxproj".into(),
        out: "old-gif".into(),
        format: ExportFormat::Gif,
        fps: 20,
        gif: None,
    })
    .unwrap();
    assert_eq!(fs::read(&path).unwrap(), before);
    let mut edit = Patch {
        project: "legacy.vfxproj".into(),
        expected_revision: 0,
        operations: vec![Operation::SetName {
            name: "Upgraded effect".into(),
        }],
        dry_run: true,
    };
    w.patch(edit.clone()).unwrap();
    assert_eq!(fs::read(&path).unwrap(), before);
    edit.dry_run = false;
    let result = w.patch(edit).unwrap();
    assert_eq!(result["engine_version"], ENGINE_VERSION);
    assert_eq!(result["revision"], 1);
    w.history("legacy.vfxproj", 1, false).unwrap();
    assert_eq!(w.read_project("legacy.vfxproj").unwrap().scene, p.scene);
    assert_eq!(
        w.read_project("legacy.vfxproj").unwrap().engine_version,
        ENGINE_VERSION
    );
    p.engine_version = "99.0.0".into();
    fs::write(&path, serde_json::to_vec(&p).unwrap()).unwrap();
    assert_eq!(
        w.read_project("legacy.vfxproj").unwrap_err().code,
        "UNSUPPORTED_VERSION"
    );
}

#[test]
fn incomplete_parameter_bindings_report_errors_instead_of_panicking() {
    let mut custom = recipe::builtin("spark_burst").unwrap().clone();
    custom.parameters.get_mut("size").unwrap().targets.clear();
    assert_eq!(
        recipe::defaults(&custom).unwrap_err().code,
        "INVALID_RECIPE"
    );
}

#[test]
fn cumulative_trail_raster_budget_aborts_and_cleans_staged_exports() {
    let (dir, w) = workspace();
    let mut s = recipe::builtin("spark_burst").unwrap().scene.clone();
    s.simulation.duration_seconds = 1.0;
    s.canvas.pixel_mode = false;
    s.nodes = vec![
        Node {
            id: "source".into(),
            kind: NodeKind::EmitterBurst {
                count: 128,
                lifetime: [2.0, 2.0],
                speed: [10.0, 10.0],
                angle_degrees: [0.0, 0.0],
                origin: [28.0, 32.0],
            },
        },
        Node {
            id: "size".into(),
            kind: NodeKind::SizeOverLife {
                start: 8.0,
                end: 8.0,
            },
        },
        Node {
            id: "trail".into(),
            kind: NodeKind::Trail {
                seconds: 0.5,
                max_points: 32,
                width_scale: 4.0,
            },
        },
        Node {
            id: "render".into(),
            kind: NodeKind::Renderer {
                blend: Blend::Normal,
                shape: Shape::Circle,
            },
        },
    ];
    s.edges = vec![
        Edge {
            from: "source".into(),
            to: "size".into(),
        },
        Edge {
            from: "size".into(),
            to: "trail".into(),
        },
        Edge {
            from: "trail".into(),
            to: "render".into(),
        },
    ];
    fs::write(
        dir.path().join("heavy.vfxproj"),
        serde_json::to_vec(&Project::new(s)).unwrap(),
    )
    .unwrap();
    let error = w
        .export(ExportRequest {
            project: "heavy.vfxproj".into(),
            out: "unfinished".into(),
            format: ExportFormat::Sequence,
            fps: 20,
            gif: None,
        })
        .unwrap_err();
    assert_eq!(error.code, "LIMIT_EXCEEDED");
    assert!(
        error
            .message
            .starts_with("Actual raster work exceeded the request budget"),
        "{error}"
    );
    assert!(!dir.path().join("unfinished").exists());
    assert!(
        !fs::read_dir(dir.path())
            .unwrap()
            .any(|e| e.unwrap().file_type().unwrap().is_dir())
    );
}
