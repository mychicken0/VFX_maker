#!/usr/bin/env python3
"""Load a real VFX Maker Godot export and verify frames, rectangles and timing in Godot 4."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

SCRIPT = '''extends SceneTree
func fail(message: String):
    printerr("VFX_VERIFY_FAILED: ", message)
    quit(1)
func _initialize():
    var manifest: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://effect/metadata.json"))
    var frames = load("res://effect/effect.tres") as SpriteFrames
    if frames == null:
        fail("SpriteFrames resource did not load")
        return
    if frames.get_frame_count("effect") != manifest.frames.size():
        fail("Frame count mismatch")
        return
    if frames.get_animation_speed("effect") != manifest.fps or frames.get_animation_loop("effect") != manifest.loop:
        fail("Animation settings mismatch")
        return
    var duration := 0.0
    for i in range(manifest.frames.size()):
        var frame: Dictionary = manifest.frames[i]
        var texture = frames.get_frame_texture("effect", i) as AtlasTexture
        var rect: Dictionary = frame.rect
        if texture == null or texture.region != Rect2(rect.x, rect.y, rect.width, rect.height):
            fail("Atlas rectangle mismatch")
            return
        if texture.atlas == null or texture.atlas.get_width() != manifest.atlas_size.width or texture.atlas.get_height() != manifest.atlas_size.height:
            fail("Atlas texture size mismatch")
            return
        var seconds = frames.get_frame_duration("effect", i) / frames.get_animation_speed("effect")
        if abs(seconds * 1000.0 - frame.duration_ms) > 0.001:
            fail("Frame duration mismatch")
            return
        duration += seconds
    if abs(duration - manifest.duration_seconds) > 0.001:
        fail("Total playback duration mismatch")
        return
    print("VFX_GODOT_OK frames=", manifest.frames.size(), " duration=", duration)
    quit(0)
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--godot", required=True, type=Path)
    parser.add_argument("--export", required=True, type=Path)
    args = parser.parse_args()
    godot = args.godot.resolve()
    export = args.export.resolve()
    metadata = json.loads((export / "metadata.json").read_text())
    if metadata["export_format"] != "godot":
        parser.error("Expected an output folder from export --format godot")
    with tempfile.TemporaryDirectory(prefix="vfx-godot-check-") as directory:
        project = Path(directory)
        # Only copy declared static resources, never caller-provided scripts.
        (project / "effect").mkdir()
        for name in ("atlas.png", "metadata.json", "effect.tres"):
            shutil.copyfile(export / name, project / "effect" / name)
        (project / "project.godot").write_text('[application]\nconfig/name="VFX verification"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n')
        (project / "verify.gd").write_text(SCRIPT)
        for flags in [("--editor", "--import", "--quit"), ("--script", "res://verify.gd")]:
            result = subprocess.run([str(godot), "--headless", "--path", str(project), *flags],
                                    capture_output=True, text=True, timeout=60)
            if result.returncode != 0 or "SCRIPT ERROR:" in result.stderr:
                raise RuntimeError(result.stdout + result.stderr)
        if "VFX_GODOT_OK" not in result.stdout:
            raise RuntimeError("Godot did not confirm resource validation: " + result.stdout + result.stderr)
        print(result.stdout.strip())


if __name__ == "__main__":
    main()
