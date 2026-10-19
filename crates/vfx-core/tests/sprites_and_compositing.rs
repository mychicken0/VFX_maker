mod common;
use common::{scene, stationary};
use serde_json::json;
use std::fs;
use vfx_core::{
    api::{ImportAsset, SaveRecipe},
    assets::ImageAsset,
    graph, render, simulation, *,
};
fn sheet() -> ImageAsset {
    let pixels = [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
        [255, 255, 0, 255],
    ]
    .concat();
    ImageAsset::from_png(&render::png_bytes(2, 2, &pixels).unwrap(), 2, 2, 4).unwrap()
}
fn sprite_scene(playback: FlipbookPlayback) -> Scene {
    let mut s = scene(
        stationary([32.0, 32.0], 1),
        vec![
            NodeKind::SizeOverLife {
                start: 4.0,
                end: 4.0,
            },
            NodeKind::Material {
                settings: Material {
                    sprite: Some(Sprite {
                        asset: "sheet".into(),
                        playback,
                        fps: 4.0,
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            },
        ],
    );
    s.simulation.duration_seconds = 3.0;
    s.assets.insert("sheet".into(), sheet());
    s
}
fn center(s: &Scene, time: f64) -> [u8; 4] {
    let f = render::frame(s, &graph::compile(s).unwrap(), time).unwrap();
    f.rgba[((32 * 64 + 32) * 4)..((32 * 64 + 32) * 4 + 4)]
        .try_into()
        .unwrap()
}
#[test]
fn flipbook_lifetime_once_loop_and_pingpong_select_real_texture_pixels() {
    let s = sprite_scene(FlipbookPlayback::Lifetime);
    for (time, color) in [
        (0.0, [255, 0, 0, 255]),
        (0.5, [0, 255, 0, 255]),
        (1.0, [0, 0, 255, 255]),
        (1.5, [255, 255, 0, 255]),
    ] {
        assert_eq!(center(&s, time), color);
    }
    assert_eq!(
        center(&sprite_scene(FlipbookPlayback::Once), 1.0),
        [255, 255, 0, 255]
    );
    assert_eq!(
        center(&sprite_scene(FlipbookPlayback::Loop), 1.0),
        [255, 0, 0, 255]
    );
    assert_eq!(
        center(&sprite_scene(FlipbookPlayback::PingPong), 1.25),
        [0, 255, 0, 255]
    );
}
#[test]
fn transparent_texels_bilinear_sampling_and_tint_have_no_black_fringe() {
    let raw = render::png_bytes(2, 1, &[255, 0, 0, 255, 255, 255, 255, 0]).unwrap();
    let a = ImageAsset::from_png(&raw, 1, 1, 1)
        .unwrap()
        .decode()
        .unwrap();
    assert_eq!(&a.rgba[4..], [0; 4]);
    let mixed = a.sample(0, [0.5, 0.5], true);
    assert_eq!(mixed, [0.5, 0.0, 0.0, 0.5]);
    let mut s = sprite_scene(FlipbookPlayback::Once);
    s.canvas.pixel_mode = false;
    s.assets
        .insert("sheet".into(), ImageAsset::from_png(&raw, 1, 1, 1).unwrap());
    let f = render::frame(&s, &graph::compile(&s).unwrap(), 0.0).unwrap();
    assert!(
        f.rgba
            .as_chunks::<4>()
            .0
            .iter()
            .any(|p| p[3] > 0 && p[3] < 255)
    );
    for p in f.rgba.as_chunks::<4>().0 {
        if p[3] > 0 {
            assert_eq!(p[0], 255);
            assert_eq!(p[1], 0);
        } else {
            assert_eq!(*p, [0; 4]);
        }
    }
}
#[test]
fn invalid_png_dimensions_grid_base64_and_asset_references_fail() {
    assert!(ImageAsset::from_png(b"not PNG", 1, 1, 1).is_err());
    let mut bad = sheet();
    bad.png = "%%%".into();
    assert_eq!(bad.decode().unwrap_err().code, "INVALID_ASSET");
    let mut bad = sheet();
    bad.columns = 3;
    assert!(bad.decode().is_err());
    let big = render::png_bytes(600, 600, &vec![0; 600 * 600 * 4]).unwrap();
    assert_eq!(
        ImageAsset::from_png(&big, 1, 1, 1).unwrap_err().code,
        "LIMIT_EXCEEDED"
    );
    let mut s = sprite_scene(FlipbookPlayback::Once);
    s.assets.clear();
    assert!(graph::compile(&s).is_err());
    let mut s = sprite_scene(FlipbookPlayback::Once);
    if let NodeKind::Material { settings } = &mut s.nodes[2].kind {
        settings.sprite.as_mut().unwrap().start_frame = 4;
    }
    assert!(graph::compile(&s).is_err());
}
#[test]
fn rotation_alignment_scale_and_velocity_stretch_change_actual_geometry() {
    let mut source = stationary([32.0, 32.0], 1);
    if let NodeKind::EmitterShape {
        speed,
        angle_degrees,
        ..
    } = &mut source
    {
        *speed = [10.0, 10.0];
        *angle_degrees = [90.0, 90.0];
    }
    let make = |aligned| {
        scene(
            source.clone(),
            vec![
                NodeKind::SizeOverLife {
                    start: 2.0,
                    end: 2.0,
                },
                NodeKind::Material {
                    settings: Material {
                        shape: Some(Shape::Quad),
                        scale: [3.0, 1.0],
                        align_velocity: aligned,
                        velocity_stretch: 0.1,
                        ..Default::default()
                    },
                },
            ],
        )
    };
    let a = make(false);
    let b = make(true);
    let bounds = |s: &Scene| {
        render::frame(s, &graph::compile(s).unwrap(), 0.0)
            .unwrap()
            .stats
            .bounds
            .unwrap()
    };
    let x = bounds(&a);
    let y = bounds(&b);
    assert!(x[2] - x[0] > x[3] - x[1]);
    assert!(y[3] - y[1] > y[2] - y[0]);
    assert_eq!(center(&a, 0.0), [255; 4]);
}
#[test]
fn layers_and_screen_multiply_blends_obey_explicit_order() {
    let mut s = scene(
        stationary([32.0, 32.0], 1),
        vec![
            NodeKind::ColorOverLife {
                start: [255, 0, 0, 255],
                end: [255, 0, 0, 255],
            },
            NodeKind::Material {
                settings: Material {
                    layer: 10,
                    ..Default::default()
                },
            },
        ],
    );
    s.nodes.extend([
        Node {
            id: "z_source".into(),
            kind: stationary([32.0, 32.0], 1),
        },
        Node {
            id: "z_color".into(),
            kind: NodeKind::ColorOverLife {
                start: [0, 0, 255, 255],
                end: [0, 0, 255, 255],
            },
        },
        Node {
            id: "z_material".into(),
            kind: NodeKind::Material {
                settings: Material {
                    layer: 0,
                    ..Default::default()
                },
            },
        },
    ]);
    s.edges.extend([
        Edge {
            from: "z_source".into(),
            to: "z_color".into(),
        },
        Edge {
            from: "z_color".into(),
            to: "z_material".into(),
        },
        Edge {
            from: "z_material".into(),
            to: "render".into(),
        },
    ]);
    assert_eq!(center(&s, 0.0), [255, 0, 0, 255]);
    for (blend, expected) in [
        (Blend::Screen, [255, 0, 255, 255]),
        (Blend::Multiply, [0, 0, 0, 255]),
    ] {
        if let NodeKind::Material { settings } = &mut s.nodes[2].kind {
            settings.blend = Some(blend);
        }
        assert_eq!(center(&s, 0.0), expected);
    }
    s.nodes.reverse();
    s.edges.reverse();
    assert_eq!(center(&s, 0.0), [0, 0, 0, 255]);
}
#[test]
fn palette_dithering_enforces_palette_and_alpha_levels() {
    let mut s = scene(
        stationary([32.0, 32.0], 1),
        vec![
            NodeKind::SizeOverLife {
                start: 16.0,
                end: 16.0,
            },
            NodeKind::ColorOverLife {
                start: [160, 160, 160, 120],
                end: [160, 160, 160, 120],
            },
        ],
    );
    let colors = vec![[0, 0, 0], [255, 255, 255]];
    s.post_process = vec![PostProcess::Palette {
        colors: colors.clone(),
        dither: 1.0,
        alpha_levels: 4,
    }];
    let f = render::frame(&s, &graph::compile(&s).unwrap(), 0.0).unwrap();
    let mut black = false;
    let mut white = false;
    for p in f.rgba.as_chunks::<4>().0 {
        assert!([0, 85, 170, 255].contains(&p[3]));
        if p[3] > 0 {
            assert!(colors.contains(&[p[0], p[1], p[2]]));
            black |= p[0] == 0;
            white |= p[0] == 255;
        }
    }
    assert!(black && white);
}
#[test]
fn mask_and_wave_distortion_change_pixels_keep_alpha_and_repeat() {
    let mut s = scene(
        stationary([32.0, 32.0], 1),
        vec![NodeKind::SizeOverLife {
            start: 14.0,
            end: 14.0,
        }],
    );
    let mask = render::png_bytes(2, 1, &[255, 255, 255, 255, 255, 255, 255, 0]).unwrap();
    s.assets
        .insert("mask".into(), ImageAsset::from_png(&mask, 1, 1, 1).unwrap());
    s.post_process = vec![PostProcess::Mask {
        asset: "mask".into(),
        frame: 0,
        channel: MaskChannel::Alpha,
        invert: false,
    }];
    let original = render::frame(&s, &graph::compile(&s).unwrap(), 0.0).unwrap();
    assert_eq!(original.rgba[((32 * 64 + 35) * 4) + 3], 0);
    assert_eq!(original.rgba[((32 * 64 + 25) * 4) + 3], 255);
    s.post_process.push(PostProcess::WaveDistortion {
        amount: [4.0, 0.0],
        frequency: [0.05, 0.0],
        period_seconds: 0.5,
    });
    let g = graph::compile(&s).unwrap();
    let shifted = render::frame(&s, &g, 0.0).unwrap();
    assert_ne!(original.rgba, shifted.rgba);
    assert_eq!(shifted.rgba, render::frame(&s, &g, 0.5).unwrap().rgba);
    assert!(
        shifted
            .rgba
            .as_chunks::<4>()
            .0
            .iter()
            .all(|p| p[3] != 0 || p[..3] == [0, 0, 0])
    );
    // Stretching an opaque 1x1 mask in smooth mode must not darken canvas edges.
    s.canvas.pixel_mode = false;
    s.assets.insert(
        "mask".into(),
        ImageAsset::from_png(&render::png_bytes(1, 1, &[255; 4]).unwrap(), 1, 1, 1).unwrap(),
    );
    s.post_process = vec![PostProcess::Mask {
        asset: "mask".into(),
        frame: 0,
        channel: MaskChannel::Alpha,
        invert: false,
    }];
    let masked = render::frame(&s, &graph::compile(&s).unwrap(), 0.0).unwrap();
    s.post_process.clear();
    assert_eq!(
        masked.rgba,
        render::frame(&s, &graph::compile(&s).unwrap(), 0.0)
            .unwrap()
            .rgba
    );
}
#[test]
fn imported_assets_are_revisioned_portable_and_saved_into_reusable_recipes() {
    let dir = tempfile::tempdir().unwrap();
    let w = Workspace::new(dir.path()).unwrap();
    w.new_project(serde_json::from_value(json!({"path":"p.vfxproj"})).unwrap())
        .unwrap();
    let bytes = render::png_bytes(1, 1, &[255, 0, 100, 255]).unwrap();
    fs::write(dir.path().join("sprite.png"), &bytes).unwrap();
    let mut request = ImportAsset {
        project: "p.vfxproj".into(),
        file: "sprite.png".into(),
        id: "sprite".into(),
        expected_revision: 0,
        columns: 1,
        rows: 1,
        frames: None,
        dry_run: true,
    };
    w.import_asset(request.clone()).unwrap();
    assert!(w.read_project("p.vfxproj").unwrap().scene.assets.is_empty());
    request.dry_run = false;
    w.import_asset(request.clone()).unwrap();
    assert_eq!(
        w.import_asset(request).unwrap_err().code,
        "REVISION_CONFLICT"
    );
    fs::remove_file(dir.path().join("sprite.png")).unwrap();
    assert_eq!(w.list_assets("p.vfxproj").unwrap()[0]["frames"], 1);
    w.history("p.vfxproj", 1, false).unwrap();
    assert!(w.read_project("p.vfxproj").unwrap().scene.assets.is_empty());
    w.history("p.vfxproj", 2, true).unwrap();
    w.save_recipe(SaveRecipe {
        project: "p.vfxproj".into(),
        out: "custom.json".into(),
        id: "portable".into(),
        description: "Embedded asset survives source file deletion".into(),
    })
    .unwrap();
    w.new_project(
        serde_json::from_value(json!({"path":"copy.vfxproj","preset_file":"custom.json"})).unwrap(),
    )
    .unwrap();
    assert_eq!(
        w.read_project("p.vfxproj").unwrap().scene.assets,
        w.read_project("copy.vfxproj").unwrap().scene.assets
    );
    let before = fs::read(dir.path().join("copy.vfxproj")).unwrap();
    assert!(
        w.import_asset(ImportAsset {
            project: "copy.vfxproj".into(),
            file: "../outside.png".into(),
            id: "bad".into(),
            expected_revision: 0,
            columns: 1,
            rows: 1,
            frames: None,
            dry_run: false
        })
        .is_err()
    );
    assert_eq!(fs::read(dir.path().join("copy.vfxproj")).unwrap(), before);
}
#[test]
fn removing_an_in_use_asset_is_an_atomic_validation_error() {
    let dir = tempfile::tempdir().unwrap();
    let w = Workspace::new(dir.path()).unwrap();
    let p = Project::new(sprite_scene(FlipbookPlayback::Once));
    fs::write(
        dir.path().join("s.vfxproj"),
        serde_json::to_vec(&p).unwrap(),
    )
    .unwrap();
    let before = fs::read(dir.path().join("s.vfxproj")).unwrap();
    assert!(
        w.patch(Patch {
            project: "s.vfxproj".into(),
            expected_revision: 0,
            operations: vec![Operation::RemoveAsset { id: "sheet".into() }],
            dry_run: false
        })
        .is_err()
    );
    assert_eq!(fs::read(dir.path().join("s.vfxproj")).unwrap(), before);
}

#[test]
fn material_and_timeline_commands_rewire_atomically_update_in_place_and_undo() {
    let dir = tempfile::tempdir().unwrap();
    let w = Workspace::new(dir.path()).unwrap();
    w.new_project(serde_json::from_value(json!({"path":"p.vfxproj"})).unwrap())
        .unwrap();
    let original = fs::read(dir.path().join("p.vfxproj")).unwrap();
    let mut r = api::MaterialRequest {
        project: "p.vfxproj".into(),
        emitter: "emitter".into(),
        settings: Material {
            layer: 4,
            scale: [2.0, 1.0],
            ..Default::default()
        },
        expected_revision: 0,
        dry_run: true,
    };
    w.set_material(r.clone()).unwrap();
    assert_eq!(fs::read(dir.path().join("p.vfxproj")).unwrap(), original);
    r.dry_run = false;
    w.set_material(r.clone()).unwrap();
    let once = w.read_project("p.vfxproj").unwrap();
    assert_eq!(once.scene.nodes.len(), 7);
    let id = once
        .scene
        .nodes
        .iter()
        .find(|n| matches!(n.kind, NodeKind::Material { .. }))
        .unwrap()
        .id
        .clone();
    r.expected_revision = 1;
    r.settings.layer = 8;
    w.set_material(r.clone()).unwrap();
    let updated = w.read_project("p.vfxproj").unwrap();
    assert_eq!(updated.scene.nodes.len(), 7);
    assert!(
        updated
            .scene
            .nodes
            .iter()
            .any(|n| n.id == id
                && matches!(&n.kind,NodeKind::Material{settings}if settings.layer==8))
    );
    r.expected_revision = 0;
    assert_eq!(w.set_material(r).unwrap_err().code, "REVISION_CONFLICT");
    w.set_timeline(api::TimelineRequest {
        project: "p.vfxproj".into(),
        emitter: "emitter".into(),
        settings: Timeline {
            delay_seconds: 0.2,
            duration_seconds: 0.6,
            repeat: false,
        },
        expected_revision: 2,
        dry_run: false,
    })
    .unwrap();
    let p = w.read_project("p.vfxproj").unwrap();
    assert_eq!(p.scene.nodes.len(), 8);
    assert!(
        simulation::snapshot(&p.scene, &graph::compile(&p.scene).unwrap(), 0.1)
            .unwrap()
            .is_empty()
    );
    w.history("p.vfxproj", 3, false).unwrap();
    assert_eq!(w.read_project("p.vfxproj").unwrap().scene, updated.scene);
}

#[test]
fn total_decoded_asset_budget_is_checked_even_for_small_compressed_files() {
    let pixels = vec![0; 512 * 512 * 4];
    let asset =
        ImageAsset::from_png(&render::png_bytes(512, 512, &pixels).unwrap(), 1, 1, 1).unwrap();
    let mut s = scene(stationary([32.0, 32.0], 1), vec![]);
    for i in 0..5 {
        s.assets.insert(format!("asset_{i}"), asset.clone());
    }
    assert_eq!(graph::compile(&s).unwrap_err().code, "LIMIT_EXCEEDED");
}
