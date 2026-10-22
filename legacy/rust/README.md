# VFX Maker

Standalone **Terminal + MCP** tools for deterministic 2D and pixel-art VFX.
Install `vfx` and `vfx-mcp` once and use them in any game repository or asset
folder. Runtime needs no source checkout, GPU, display, Rust, Python, Node.js,
LLM account or internet connection.

Version **0.3** supports embedded PNG sprites and flipbooks, rotation and velocity
alignment/stretch, explicit layers and blend modes, per-emitter timelines,
ordered palette/dithering/mask/distortion operations, incremental simulation and
cancellable background exports through MCP. It exports transparent PNG assets,
GIFs, Godot SpriteFrames and Unity import folders.

Eighteen editable data recipes ship inside the binaries. New examples include
`stardust`, `flipbook_burst`, `energy_orb_loop`, `charge_impact`, `masked_portal`
and `pixel_flame`, alongside the original sword, fire, smoke, rain and magic
recipes. Discover complete descriptions and parameters with `vfx preset list`.

Effects are scene data, not branches keyed on effect names. Load your own recipe
file without rebuilding. CLI and MCP share the same graph, rendering, revision
checks, atomic edits and persistent undo/redo. A native GUI and GPU backend remain
future work.

View the actual renders: [charge and impact](examples/rendered/charge-impact.gif) ·
[portal loop](examples/rendered/portal-loop.gif) ·
[red magic sword GIF](examples/rendered/red-magic-cross.gif) ·
[12-effect gallery GIF](examples/rendered/overview.gif). These examples are retained
in the repository alongside the source.

## Install

Build with Rust 1.99.1 and a C linker. The toolchain and Cargo dependencies are
pinned. From any directory:

```bash
bash /path/to/VFX_maker/scripts/install.sh
export PATH="$HOME/.local/bin:$PATH"
vfx --version
vfx doctor --json
```

Use `scripts/install.sh /path/to/tools` for another installation prefix. The
script replaces both executables in that prefix. Only building needs Rust.
Linux x86_64 is validated; macOS and Windows builds are not verified. Prepared
Linux binary bundles also include a Rust-free `install.sh`.

## Create the red magic sword slash

```bash
cd /path/to/your/game
vfx new slash.vfxproj --preset red_magic_cross --canvas 96x96 --seed 42
vfx preview slash.vfxproj --times 0.15,0.3,0.45,0.65 --out slash-preview.png
vfx export slash.vfxproj --format gif --fps 25 --scale 5 \
  --background '#100811' --out slash-gif
vfx export slash.vfxproj --format spritesheet --fps 25 --out slash-atlas
```

The outputs are a 480×480 looping `slash-gif/animation.gif` and a transparent
96×96-frame PNG atlas with JSON frame rectangles/timing/hashes. GIF uses an
opaque background; PNG preserves partial alpha. No FFmpeg is required.
`--no-loop` plays the GIF once. Repeating playback does not guarantee a seamless
animation. All new output names must be unused.

The default file root is the current directory. Use `vfx --root /path/to/game`
to work elsewhere; no Git repository is required. All input/output paths must
stay inside this root, and parent directories must already exist.

## Use your own sprites

Place a PNG sprite or sheet inside your chosen project root. Import is revision
checked and embeds the PNG, so moving the project does not lose its textures.
For a 3×2 sheet with six frames named `my-sheet.png`:

```bash
vfx new particles.vfxproj --preset spark_burst
vfx asset import particles.vfxproj --file my-sheet.png --id sprite \
  --columns 3 --rows 2 --frames 6 --expected-revision 0
vfx material particles.vfxproj --emitter emitter --expected-revision 1 \
  --settings '{"sprite":{"asset":"sprite","playback":"lifetime"},"rotation_degrees":[-45,45],"layer":2}'
vfx timeline particles.vfxproj --emitter emitter --expected-revision 2 \
  --settings '{"delay_seconds":0.1,"duration_seconds":0.7,"repeat":false}'
vfx export particles.vfxproj --format gif --out textured-gif --progress
```

The material/timeline commands insert or update their nodes automatically. For
asset-free setup, `vfx new blast.vfxproj --preset flipbook_burst` already contains
an original demonstration sheet. See the [production workflow](docs/PRODUCTION_WORKFLOW.md)
for transforms, post-processing, background jobs and portable custom recipes.

## Export into a game

```bash
vfx new portal.vfxproj --preset masked_portal
vfx export portal.vfxproj --format godot --fps 25 --out portal-godot
vfx export portal.vfxproj --format unity --fps 25 --out portal-unity
vfx analyze portal.vfxproj --samples 12 --compare-fresh --json
```

Godot output includes `atlas.png`, `metadata.json` and `effect.tres`; assign the
resource to an AnimatedSprite2D. Unity output includes an Editor importer that
creates sliced sprites and an animation clip; it requires Unity 2022.3+ and the
2D Sprite package. Read each output's `IMPORT.txt`.

Actual Godot 4.5.1 loading, frame rectangles and durations are verified with
`scripts/verify_godot.py`. Unity host execution has not been verified here.
`analyze --compare-fresh` measures cached versus fresh rendering and verifies
pixel equality for the requested samples; speedups depend on the scene/machine.

## Customize without application code

```bash
vfx preset list --json
vfx preset show spark_burst --json
vfx new impact.vfxproj --preset spark_burst \
  --params '{"count":80,"size":2.5,"color":[255,50,100,255]}'
vfx preset show spark_burst --out my-effect.recipe.json
# Edit the recipe's graph, parameter declarations or keyframes in a text editor.
vfx new custom.vfxproj --preset-file my-effect.recipe.json --canvas 128x128
vfx export custom.vfxproj --format gif --fps 25 --scale 3 --out custom-gif
```

Recipes expose their own typed parameters; unknown names fail. Exporting a
recipe saves a reusable template. Creating a project copies its graph; later
recipe-file edits do not silently change existing projects. See
[recipe and node guide](docs/RECIPES.md) for bindings, curves, forces and scaling.

To render every discovered built-in recipe through the CLI:

```bash
python3 scripts/render_gallery.py --vfx /absolute/path/to/vfx --out /new/gallery
```

Add `--engine godot --engine unity` to include downloadable game asset folders.
Open the resulting offline `index.html`. Every card links its GIF, transparent
atlas and editable project. Python is only needed by this optional batch script.

## Connect Codex / Claude

Let the client launch `vfx-mcp --root /path/to/projects --stdio`. Use an absolute
binary path because GUI clients may not inherit shell PATH. One root can contain
multiple game folders.

```bash
codex mcp add vfx -- /absolute/path/to/vfx-mcp --root /path/to/projects --stdio
```

For Claude Desktop or clients using `mcpServers`, merge this entry into existing
settings, using real absolute paths:

```json
{
  "mcpServers": {
    "vfx": {
      "command": "/absolute/path/to/vfx-mcp",
      "args": ["--root", "/path/to/projects", "--stdio"]
    }
  }
}
```

The server exposes 22 tools, typed JSON schemas, inline PNG previews and bounded background export jobs. See the
[agent playbook](docs/AGENT_PLAYBOOK.md) and [command reference](docs/COMMANDS.md).
The official Rust SDK child-client workflow is tested; external Codex/Claude UI
sessions have not been exercised. Installation does not modify host settings.

## Edit existing projects

Inspect the current revision before editing. All changes validate atomically.

```bash
vfx inspect impact.vfxproj --json
vfx patch impact.vfxproj --expected-revision 0 --dry-run \
  --ops '[{"op":"set_name","name":"Golden impact"}]'
vfx patch impact.vfxproj --expected-revision 0 \
  --ops '[{"op":"set_name","name":"Golden impact"}]'
vfx undo impact.vfxproj --expected-revision 1
vfx redo impact.vfxproj --expected-revision 2
```

Old schema-1 projects from engines 0.1.0 and 0.2.0 can be opened/rendered without rewriting.
The first committed edit upgrades their engine header to the current version.
A dry-run does not upgrade it. Future unsupported versions are rejected.

## Development and sources

```bash
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
```

See [architecture](docs/ARCHITECTURE.md), [60 integration checks](docs/TEST_PLAN.md),
[15 researched open-source projects](docs/OPEN_SOURCE_RESEARCH.md) with pinned
revisions and license evidence, and [dependency notices](THIRD_PARTY_NOTICES.md).
`gif` and `noise` are integrated upstream crates; editor/engine source and assets
were not copied. GitHub Actions is configured; local success is not a hosted run.
