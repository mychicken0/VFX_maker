# VFX Maker

Standalone **Terminal + MCP** tools for deterministic 2D and pixel-art VFX.
Install `vfx` and `vfx-mcp` once and use them in any game repository or asset
folder. Runtime needs no source checkout, GPU, display, Rust, Python, Node.js,
LLM account or internet connection.

Version 0.2 adds data-only JSON recipes, animation curves/gradients, shape and
path emission, vortex/attractor/turbulence forces, trails, transparent glow and
**native GIF export**. Twelve editable recipes ship inside the binaries:
`spark_burst`, `blue_magic`, `fire`, `smoke`, `dust`, `rain`, `magic_ring`,
`lightning`, `heal_pulse`, `vortex`, `comet`, `red_magic_cross`.

Effects are scene data, not branches keyed on effect names. Load your own recipe
file without rebuilding. CLI and MCP share the same graph, rendering, revision
checks, atomic edits and persistent undo/redo. A native GUI and GPU backend remain
future work.

View the actual renders: [red magic sword GIF](examples/rendered/red-magic-cross.gif) ·
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

The server exposes 13 tools, typed JSON schemas and inline PNG previews. See the
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

Old schema-1 projects from engine 0.1.0 can be opened/rendered without rewriting.
The first committed edit upgrades their engine header to the current version.
A dry-run does not upgrade it. Future unsupported versions are rejected.

## Development and sources

```bash
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
```

See [architecture](docs/ARCHITECTURE.md), [38 integration checks](docs/TEST_PLAN.md),
[15 researched open-source projects](docs/OPEN_SOURCE_RESEARCH.md) with pinned
revisions and license evidence, and [dependency notices](THIRD_PARTY_NOTICES.md).
`gif` and `noise` are integrated upstream crates; editor/engine source and assets
were not copied. GitHub Actions is configured; local success is not a hosted run.
