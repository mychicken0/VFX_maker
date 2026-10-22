import { mkdtemp, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
const VERSION = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
).version;
const run = promisify(execFile);
const [engine, folder] = process.argv.slice(2);
if (!engine || !folder)
  throw new Error(
    "Usage: node scripts/verify-godot.mjs /path/to/godot /path/to/export",
  );
const source = resolve(folder),
  root = await mkdtemp(join(tmpdir(), "vfx-godot-"));
try {
  for (const name of ["atlas.png", "metadata.json", "effect.tres"])
    await copyFile(join(source, name), join(root, name));
  const meta = JSON.parse(await readFile(join(root, "metadata.json"), "utf8"));
  if (meta.version !== VERSION) throw new Error(`Expected ${VERSION} metadata`);
  await writeFile(
    join(root, "project.godot"),
    '[application]\nconfig/name="VFX resource verification"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n',
  );
  await writeFile(
    join(root, "verify.gd"),
    `extends SceneTree
func _init():
    var sf = load("res://effect.tres") as SpriteFrames
    assert(sf != null, "SpriteFrames resource failed to load")
    var meta = JSON.parse_string(FileAccess.get_file_as_string("res://metadata.json"))
    assert(sf.get_frame_count("default") == meta.frames.size())
    assert(abs(sf.get_animation_speed("default") - meta.fps) < 0.0001)
    assert(sf.get_animation_loop("default") == meta.loop)
    var total = 0.0
    for i in range(meta.frames.size()):
        var frame = meta.frames[i]
        var texture = sf.get_frame_texture("default", i) as AtlasTexture
        assert(texture != null)
        assert(texture.region == Rect2(frame.rect.x, frame.rect.y, frame.rect.width, frame.rect.height))
        assert(texture.atlas.get_width() == meta.atlas.width)
        assert(texture.atlas.get_height() == meta.atlas.height)
        var duration = sf.get_frame_duration("default", i) / sf.get_animation_speed("default")
        assert(abs(duration - frame.duration) < 0.000001)
        total += duration
    assert(abs(total - meta.duration) < 0.00001)
    print("VFX_GODOT_OK ", meta.frames.size(), " frames / ", total, " seconds")
    quit()
`,
  );
  await run(engine, ["--headless", "--path", root, "--editor", "--import"], {
    timeout: 60000,
  });
  const result = await run(
    engine,
    ["--headless", "--path", root, "--script", "verify.gd"],
    { timeout: 30000 },
  );
  if (
    !result.stdout.includes("VFX_GODOT_OK") ||
    /SCRIPT ERROR|Assertion failed/.test(result.stderr)
  )
    throw new Error(result.stdout + result.stderr);
  process.stdout.write(result.stdout);
} finally {
  await rm(root, { recursive: true, force: true });
}
