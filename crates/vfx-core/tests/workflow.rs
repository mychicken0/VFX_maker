use std::{
    fs,
    io::Cursor,
    sync::{Arc, Barrier},
};
use vfx_core::{export, graph, render, simulation, *};

fn workspace() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().unwrap();
    let w = Workspace::new(dir.path()).unwrap();
    w.new_project(serde_json::from_value(serde_json::json!({"path":"spark.vfxproj"})).unwrap())
        .unwrap();
    (dir, w)
}
fn patch(
    w: &Workspace,
    revision: u64,
    operations: Vec<Operation>,
    dry_run: bool,
) -> Result<serde_json::Value> {
    w.patch(Patch {
        project: "spark.vfxproj".into(),
        expected_revision: revision,
        operations,
        dry_run,
    })
}
fn rename(name: &str) -> Operation {
    Operation::SetName { name: name.into() }
}
fn decode(bytes: &[u8]) -> (u32, u32, Vec<u8>) {
    let mut reader = png::Decoder::new(Cursor::new(bytes)).read_info().unwrap();
    let mut data = vec![0; reader.output_buffer_size().unwrap()];
    let info = reader.next_frame(&mut data).unwrap();
    assert_eq!(info.color_type, png::ColorType::Rgba);
    data.truncate(info.buffer_size());
    (info.width, info.height, data)
}

#[test]
fn transactions_are_atomic_dry_run_revisioned_and_persistently_undoable() {
    let (dir, w) = workspace();
    let before = fs::read(dir.path().join("spark.vfxproj")).unwrap();
    let bad = Operation::SetCanvas {
        canvas: Canvas {
            width: 0,
            height: 64,
            pixel_mode: true,
        },
    };
    assert!(patch(&w, 0, vec![rename("bad"), bad], false).is_err());
    assert_eq!(fs::read(dir.path().join("spark.vfxproj")).unwrap(), before);
    let dry = patch(&w, 0, vec![rename("blue")], true).unwrap();
    assert_eq!(dry["revision"], 0);
    assert_eq!(dry["proposed_scene"]["name"], "blue");
    assert_eq!(fs::read(dir.path().join("spark.vfxproj")).unwrap(), before);
    assert_eq!(
        patch(&w, 0, vec![rename("blue")], false).unwrap()["revision"],
        1
    );
    assert_eq!(
        patch(&w, 0, vec![rename("stale")], false).unwrap_err().code,
        "REVISION_CONFLICT"
    );
    let reopened = Workspace::new(dir.path()).unwrap();
    assert_eq!(
        reopened.history("spark.vfxproj", 1, false).unwrap()["revision"],
        2
    );
    assert_eq!(
        reopened.read_project("spark.vfxproj").unwrap().scene.name,
        "spark burst"
    );
    assert_eq!(
        reopened.history("spark.vfxproj", 2, true).unwrap()["scene"]["name"],
        "blue"
    );
    assert_eq!(reopened.read_project("spark.vfxproj").unwrap().revision, 3);
    assert_eq!(
        patch(&w, 3, vec![rename("blue")], false).unwrap_err().code,
        "NO_CHANGE"
    );
}

#[test]
fn two_editors_cannot_silently_overwrite_each_other() {
    let (_dir, w) = workspace();
    let gate = Arc::new(Barrier::new(2));
    let jobs: Vec<_> = (0..2)
        .map(|i| {
            let w = w.clone();
            let gate = gate.clone();
            std::thread::spawn(move || {
                gate.wait();
                patch(&w, 0, vec![rename(&format!("editor {i}"))], false)
            })
        })
        .collect();
    let results: Vec<_> = jobs.into_iter().map(|j| j.join().unwrap()).collect();
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert!(
        results
            .iter()
            .filter_map(|r| r.as_ref().err())
            .all(|e| ["BUSY", "REVISION_CONFLICT"].contains(&e.code))
    );
    assert_eq!(w.read_project("spark.vfxproj").unwrap().revision, 1);
}

#[test]
fn graph_validation_rejects_cycles_bad_connections_and_limits() {
    let (_dir, w) = workspace();
    let scene = w.read_project("spark.vfxproj").unwrap().scene;
    let mut cyclic = scene.clone();
    cyclic.edges[0].from = "drag".into();
    assert_eq!(graph::compile(&cyclic).unwrap_err().code, "GRAPH_CYCLE");
    let mut invalid = scene.clone();
    invalid.edges.push(Edge {
        from: "render".into(),
        to: "gravity".into(),
    });
    assert_eq!(
        graph::compile(&invalid).unwrap_err().code,
        "INVALID_PORT_TYPE"
    );
    let mut duplicate = scene.clone();
    duplicate.nodes.push(duplicate.nodes[0].clone());
    assert!(graph::compile(&duplicate).is_err());
    let mut huge = scene.clone();
    if let NodeKind::EmitterBurst { count, .. } = &mut huge.nodes[0].kind {
        *count = 4097;
    }
    assert_eq!(graph::compile(&huge).unwrap_err().code, "LIMIT_EXCEEDED");
    let mut nan = scene;
    nan.simulation.duration_seconds = f64::NAN;
    assert!(graph::compile(&nan).is_err());
    assert!(
        serde_json::from_str::<Operation>(r#"{"op":"set_name","name":"x","typo":true}"#).is_err()
    );
}

#[test]
fn snapshots_are_repeatable_and_stable_when_other_emitters_are_added() {
    let (_dir, w) = workspace();
    let mut scene = w.read_project("spark.vfxproj").unwrap().scene;
    let graph = graph::compile(&scene).unwrap();
    let first = simulation::snapshot(&scene, &graph, 0.2).unwrap();
    assert_eq!(first, simulation::snapshot(&scene, &graph, 0.2).unwrap());
    // Backward scrubbing recomputes from the same origin, never negative dt.
    simulation::snapshot(&scene, &graph, 0.6).unwrap();
    assert_eq!(first, simulation::snapshot(&scene, &graph, 0.2).unwrap());
    let mut node = scene.nodes[0].clone();
    node.id = "zz_independent".into();
    scene.nodes.push(node);
    scene.edges.push(Edge {
        from: "zz_independent".into(),
        to: "render".into(),
    });
    let other = simulation::snapshot(&scene, &graph::compile(&scene).unwrap(), 0.2).unwrap();
    assert_eq!(&other[..first.len()], first);
}

#[test]
fn birth_and_death_follow_fixed_ticks_and_explicit_lifetimes() {
    let (_dir, w) = workspace();
    let mut scene = w.read_project("spark.vfxproj").unwrap().scene;
    scene.nodes[0].kind = NodeKind::EmitterBurst {
        count: 1,
        lifetime: [0.1, 0.1],
        speed: [0.0, 0.0],
        angle_degrees: [0.0, 0.0],
        origin: [32.0, 32.0],
    };
    let graph = graph::compile(&scene).unwrap();
    assert_eq!(
        simulation::snapshot(&scene, &graph, 0.099).unwrap().len(),
        1
    );
    assert_eq!(simulation::snapshot(&scene, &graph, 0.1).unwrap().len(), 0);
    scene.nodes[0].kind = NodeKind::EmitterStream {
        rate: 60.0,
        lifetime: [2.0, 2.0],
        speed: [0.0, 0.0],
        angle_degrees: [0.0, 0.0],
        origin: [32.0, 32.0],
    };
    let graph = graph::compile(&scene).unwrap();
    assert!(
        simulation::snapshot(&scene, &graph, 0.0)
            .unwrap()
            .is_empty()
    );
    assert_eq!(simulation::snapshot(&scene, &graph, 0.5).unwrap().len(), 30);
    assert_eq!(
        simulation::snapshot(&scene, &graph, 0.8).unwrap_err().code,
        "INVALID_TIME"
    );
}

#[test]
fn rendered_rgba_is_golden_and_preserves_transparency() {
    let (_dir, w) = workspace();
    let scene = w.read_project("spark.vfxproj").unwrap().scene;
    let graph = graph::compile(&scene).unwrap();
    let frame = render::frame(&scene, &graph, 0.2).unwrap();
    assert!(frame.stats.nontransparent_pixels > 50);
    assert!(frame.stats.alpha_coverage < 0.5);
    assert_eq!(frame.rgba[3], 0);
    assert!(
        frame
            .rgba
            .as_chunks::<4>()
            .0
            .iter()
            .any(|p| p[3] > 0 && p[3] < 255)
    );
    assert_eq!(
        export::hash(&frame.rgba),
        include_str!("fixtures/spark.sha256").trim()
    );
    let png = render::png_bytes(64, 64, &frame.rgba).unwrap();
    let (width, height, decoded) = decode(&png);
    assert_eq!((width, height), (64, 64));
    assert_eq!(decoded, frame.rgba);
}

#[test]
fn spritesheet_rects_match_sequence_frames_and_export_fps_does_not_change_simulation() {
    let (dir, w) = workspace();
    for (out, format, fps) in [
        ("atlas", ExportFormat::Spritesheet, 20),
        ("seq", ExportFormat::Sequence, 10),
    ] {
        let result = w
            .export(ExportRequest {
                gif: None,
                project: "spark.vfxproj".into(),
                out: out.into(),
                format,
                fps,
            })
            .unwrap();
        assert_eq!(result["frame_count"], (0.8 * f64::from(fps)).ceil() as u32);
    }
    let atlas: serde_json::Value =
        serde_json::from_slice(&fs::read(dir.path().join("atlas/metadata.json")).unwrap()).unwrap();
    let sequence: serde_json::Value =
        serde_json::from_slice(&fs::read(dir.path().join("seq/metadata.json")).unwrap()).unwrap();
    assert_eq!(
        atlas["frames"][4]["pixel_sha256"],
        sequence["frames"][2]["pixel_sha256"]
    );
    let (aw, _, pixels) = decode(&fs::read(dir.path().join("atlas/atlas.png")).unwrap());
    let (_, _, frame) = decode(&fs::read(dir.path().join("seq/frame_0002.png")).unwrap());
    let rect = &atlas["frames"][4]["rect"];
    let x = rect["x"].as_u64().unwrap() as usize;
    let y = rect["y"].as_u64().unwrap() as usize;
    for row in 0..64 {
        assert_eq!(
            &pixels[((y + row) * aw as usize + x) * 4..((y + row) * aw as usize + x + 64) * 4],
            &frame[row * 64 * 4..(row + 1) * 64 * 4]
        );
    }
    assert_eq!(pixels[((y - 1) * aw as usize + x) * 4 + 3], 0);
    w.export(ExportRequest {
        gif: None,
        project: "spark.vfxproj".into(),
        out: "atlas2".into(),
        format: ExportFormat::Spritesheet,
        fps: 20,
    })
    .unwrap();
    assert_eq!(
        fs::read(dir.path().join("atlas/atlas.png")).unwrap(),
        fs::read(dir.path().join("atlas2/atlas.png")).unwrap()
    );
    assert_eq!(
        fs::read(dir.path().join("atlas/metadata.json")).unwrap(),
        fs::read(dir.path().join("atlas2/metadata.json")).unwrap()
    );
    assert_eq!(
        w.export(ExportRequest {
            gif: None,
            project: "spark.vfxproj".into(),
            out: "atlas".into(),
            format: ExportFormat::Spritesheet,
            fps: 20
        })
        .unwrap_err()
        .code,
        "ALREADY_EXISTS"
    );
}

#[test]
fn every_preset_produces_visible_preview_pixels() {
    let (_dir, w) = workspace();
    for preset in ["spark_burst", "blue_magic", "fire"] {
        let path = format!("{preset}.vfxproj");
        w.new_project(
            serde_json::from_value(
                serde_json::json!({"path":path,"preset":preset,"pixel_mode":false}),
            )
            .unwrap(),
        )
        .unwrap();
        let preview = w
            .preview(PreviewRequest {
                project: path,
                times: vec![0.15, 0.3, 0.5],
            })
            .unwrap();
        assert_eq!((preview.width, preview.height), (192, 64));
        assert!(preview.frames.iter().all(|s| s.nontransparent_pixels > 0));
    }
}

#[test]
fn paths_overwrites_and_render_budgets_are_enforced() {
    let (dir, w) = workspace();
    assert_eq!(
        w.resolve("../outside.png").unwrap_err().code,
        "PATH_OUTSIDE_ROOT"
    );
    let before = fs::read(dir.path().join("spark.vfxproj")).unwrap();
    let request = serde_json::from_value(serde_json::json!({"path":"spark.vfxproj"})).unwrap();
    assert_eq!(w.new_project(request).unwrap_err().code, "ALREADY_EXISTS");
    assert_eq!(fs::read(dir.path().join("spark.vfxproj")).unwrap(), before);
    let mut scene = w.read_project("spark.vfxproj").unwrap().scene;
    scene.simulation.duration_seconds = 10.0;
    scene.simulation.tick_hz = 240;
    if let NodeKind::EmitterBurst { count, .. } = &mut scene.nodes[0].kind {
        *count = 4096;
    }
    assert_eq!(
        export::check_budget(&scene, &graph::compile(&scene).unwrap(), 300)
            .unwrap_err()
            .code,
        "LIMIT_EXCEEDED"
    );
    assert!(
        w.export(ExportRequest {
            gif: None,
            project: "spark.vfxproj".into(),
            out: "invalid".into(),
            format: ExportFormat::Sequence,
            fps: 0
        })
        .is_err()
    );
    assert!(!dir.path().join("invalid").exists());
}

#[cfg(unix)]
#[test]
fn symlinks_cannot_escape_the_selected_root() {
    let (dir, w) = workspace();
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), dir.path().join("escape")).unwrap();
    assert_eq!(
        w.resolve("escape/owned.png").unwrap_err().code,
        "PATH_OUTSIDE_ROOT"
    );
    fs::write(outside.path().join("test.json"), "{}").unwrap();
    assert_eq!(
        w.read_bytes("escape/test.json").unwrap_err().code,
        "PATH_OUTSIDE_ROOT"
    );
}
