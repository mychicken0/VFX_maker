use serde_json::{Value, json};
use std::{path::Path, process::Command};

fn cli(dir: &Path, args: &[&str], code: i32) -> Value {
    let output = Command::new(env!("CARGO_BIN_EXE_vfx"))
        .args(args)
        .arg("--json")
        .current_dir(dir)
        .env_remove("DISPLAY")
        .env_remove("WAYLAND_DISPLAY")
        .output()
        .unwrap();
    assert_eq!(
        output.status.code(),
        Some(code),
        "stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn standalone_cli_works_in_a_directory_without_source_or_display() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(cli(dir.path(), &["doctor"], 0)["data"]["headless"], true);
    assert_eq!(
        cli(
            dir.path(),
            &["new", "impact.vfxproj", "--preset", "blue_magic"],
            0
        )["data"]["revision"],
        0
    );
    let operations = json!([{"op":"set_name","name":"Portable effect"}]).to_string();
    assert_eq!(
        cli(
            dir.path(),
            &[
                "patch",
                "impact.vfxproj",
                "--expected-revision",
                "0",
                "--ops",
                &operations,
                "--dry-run"
            ],
            0
        )["data"]["dry_run"],
        true
    );
    cli(
        dir.path(),
        &[
            "patch",
            "impact.vfxproj",
            "--expected-revision",
            "0",
            "--ops",
            &operations,
        ],
        0,
    );
    assert_eq!(
        cli(
            dir.path(),
            &[
                "patch",
                "impact.vfxproj",
                "--expected-revision",
                "0",
                "--ops",
                &operations
            ],
            4
        )["error"]["code"],
        "REVISION_CONFLICT"
    );
    cli(dir.path(), &["validate", "impact.vfxproj"], 0);
    cli(
        dir.path(),
        &[
            "preview",
            "impact.vfxproj",
            "--times",
            "0.15,0.3",
            "--out",
            "preview.png",
        ],
        0,
    );
    cli(
        dir.path(),
        &["export", "impact.vfxproj", "--out", "game-assets"],
        0,
    );
    assert!(dir.path().join("preview.png").is_file());
    assert!(dir.path().join("game-assets/atlas.png").is_file());
    assert!(dir.path().join("game-assets/metadata.json").is_file());
    assert_eq!(
        cli(
            dir.path(),
            &["preview", "impact.vfxproj", "--out", "preview.png"],
            3
        )["error"]["code"],
        "ALREADY_EXISTS"
    );
    assert_eq!(
        cli(dir.path(), &["new", "../outside.vfxproj"], 5)["ok"],
        false
    );
    cli(
        dir.path(),
        &["undo", "impact.vfxproj", "--expected-revision", "1"],
        0,
    );
    cli(
        dir.path(),
        &["redo", "impact.vfxproj", "--expected-revision", "2"],
        0,
    );
    assert_eq!(
        cli(dir.path(), &["inspect", "impact.vfxproj"], 0)["data"]["scene"]["name"],
        "Portable effect"
    );
}

#[test]
fn invalid_cli_arguments_have_machine_readable_errors() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(
        cli(
            dir.path(),
            &["new", "test.vfxproj", "--canvas", "invalid"],
            2
        )["error"]["code"],
        "INVALID_ARGUMENT"
    );
    assert_eq!(
        cli(dir.path(), &["patch", "test.vfxproj"], 2)["error"]["code"],
        "INVALID_ARGUMENT"
    );
}

#[test]
fn recipe_copies_overrides_and_native_gif_export_work_outside_the_checkout() {
    let dir = tempfile::tempdir().unwrap();
    cli(
        dir.path(),
        &["preset", "show", "red_magic_cross", "--out", "custom.json"],
        0,
    );
    let path = dir.path().join("custom.json");
    let mut recipe: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    recipe["id"] = json!("external_blade");
    recipe["scene"]["name"] = json!("External Blade");
    std::fs::write(path, serde_json::to_vec(&recipe).unwrap()).unwrap();
    let created = cli(
        dir.path(),
        &[
            "new",
            "sword.vfxproj",
            "--preset-file",
            "custom.json",
            "--canvas",
            "96x96",
            "--params",
            r#"{"edge_color":[255,10,55,255],"core_width":1.4}"#,
        ],
        0,
    );
    assert_eq!(created["data"]["scene"]["name"], "External Blade");
    cli(
        dir.path(),
        &[
            "export",
            "sword.vfxproj",
            "--format",
            "gif",
            "--fps",
            "25",
            "--scale",
            "2",
            "--background",
            "#100811",
            "--out",
            "animation",
        ],
        0,
    );
    let bytes = std::fs::read(dir.path().join("animation/animation.gif")).unwrap();
    assert!(bytes.starts_with(b"GIF89a"));
    let metadata: Value =
        serde_json::from_slice(&std::fs::read(dir.path().join("animation/metadata.json")).unwrap())
            .unwrap();
    assert_eq!(metadata["output_canvas_size"]["width"], 192);
    assert_eq!(metadata["frames"].as_array().unwrap().len(), 30);
}

#[test]
fn unsupported_recipe_parameters_and_malformed_gif_flags_return_json_errors() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(
        cli(
            dir.path(),
            &["new", "bad.vfxproj", "--params", r#"{"unknown":1}"#],
            2
        )["error"]["code"],
        "UNKNOWN_PARAMETER"
    );
    cli(dir.path(), &["new", "spark.vfxproj"], 0);
    assert_eq!(
        cli(
            dir.path(),
            &[
                "export",
                "spark.vfxproj",
                "--format",
                "gif",
                "--background",
                "一abc",
                "--out",
                "bad"
            ],
            2
        )["error"]["code"],
        "INVALID_ARGUMENT"
    );
    assert_eq!(
        cli(
            dir.path(),
            &[
                "export",
                "spark.vfxproj",
                "--format",
                "spritesheet",
                "--scale",
                "2",
                "--out",
                "bad"
            ],
            2
        )["error"]["code"],
        "INVALID_ARGUMENT"
    );
    assert!(!dir.path().join("bad").exists());
}

#[test]
fn asset_recipe_engine_exports_analysis_and_stderr_progress_form_a_standalone_workflow() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("sprite.png"),
        vfx_core::render::png_bytes(2, 1, &[255, 0, 0, 255, 0, 255, 0, 255]).unwrap(),
    )
    .unwrap();
    cli(dir.path(), &["new", "effect.vfxproj"], 0);
    assert_eq!(
        cli(
            dir.path(),
            &[
                "asset",
                "import",
                "effect.vfxproj",
                "--file",
                "sprite.png",
                "--id",
                "flip",
                "--columns",
                "2",
                "--expected-revision",
                "0"
            ],
            0
        )["data"]["revision"],
        1
    );
    assert_eq!(
        cli(dir.path(), &["asset", "list", "effect.vfxproj"], 0)["data"][0]["frames"],
        2
    );
    assert_eq!(
        cli(
            dir.path(),
            &[
                "material",
                "effect.vfxproj",
                "--emitter",
                "emitter",
                "--settings",
                r#"{"sprite":{"asset":"flip"},"scale":[2,1]}"#,
                "--expected-revision",
                "1"
            ],
            0
        )["data"]["revision"],
        2
    );
    assert_eq!(
        cli(
            dir.path(),
            &[
                "timeline",
                "effect.vfxproj",
                "--emitter",
                "emitter",
                "--settings",
                r#"{"delay_seconds":0.1,"duration_seconds":0.7}"#,
                "--expected-revision",
                "2"
            ],
            0
        )["data"]["revision"],
        3
    );
    cli(
        dir.path(),
        &[
            "recipe",
            "save",
            "effect.vfxproj",
            "--id",
            "portable",
            "--description",
            "Portable sprite example",
            "--out",
            "recipe.json",
        ],
        0,
    );
    cli(
        dir.path(),
        &["new", "copy.vfxproj", "--preset-file", "recipe.json"],
        0,
    );
    let analysis = cli(
        dir.path(),
        &[
            "analyze",
            "copy.vfxproj",
            "--samples",
            "4",
            "--compare-fresh",
        ],
        0,
    );
    assert_eq!(analysis["data"]["baseline"]["pixel_parity"], true);
    let output = Command::new(env!("CARGO_BIN_EXE_vfx"))
        .args([
            "export",
            "copy.vfxproj",
            "--format",
            "godot",
            "--out",
            "engine",
            "--progress",
            "--json",
        ])
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap()["ok"],
        true
    );
    let events: Vec<Value> = String::from_utf8_lossy(&output.stderr)
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(events.last().unwrap()["phase"], "complete");
    assert!(dir.path().join("engine/effect.tres").is_file());
    cli(
        dir.path(),
        &[
            "export",
            "copy.vfxproj",
            "--format",
            "unity",
            "--out",
            "unity",
        ],
        0,
    );
    assert!(dir.path().join("unity/Editor/VfxMakerImport.cs").is_file());
}
