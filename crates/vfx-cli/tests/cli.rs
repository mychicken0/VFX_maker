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
