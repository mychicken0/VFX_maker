# VFX Maker 0.4.0

**A visual VFX studio built with TypeScript, PixiJS 8 and React 19.**
Shape a sword slash by dragging its points, retime layers in the timeline, edit
color gradients and animation curves, and export the result. No graph wiring is
required. The same Pixi renderer powers the browser editor, Terminal and MCP.

![VFX Maker Studio](examples/studio.png)

## Run

Requires **Node 22.18+** (Node 24 recommended). From source:

```bash
npm ci
npm run build
node dist/cli.js studio --open
```

Or install the prepared `vfx-maker-0.4.0.tgz` once and use it in any folder:

```bash
npm install -g /path/to/vfx-maker-0.4.0.tgz
cd /path/to/your/game
vfx studio --open
```

Source installer: `bash /path/to/VFX_maker/scripts/install.sh /path/to/tools`;
add `/path/to/tools/bin` to PATH. The installed package includes the built editor
and renderer; it does not need this checkout, Rust or a game repository.
This package has not been published to the npm registry.

**Browser:** Studio runs in a modern browser with WebGL2. CLI/MCP rendering uses
local Chrome/Chromium through Playwright. Discover it with `vfx doctor`, or use
`vfx browser install` / `VFX_CHROMIUM_PATH=/absolute/path/to/chromium`.
On Linux, install the browser's normal system libraries as well. No API key,
account or network connection is needed after installation. Linux/Chromium is
tested; macOS, Windows, Firefox and Safari are not verified.

## Customize visually

- Start with one of **18 editable effects**, or add particles, strokes, rings
  and sprites. Drag layers to change compositing order; hide, lock or duplicate.
- Drag the viewport's center handle to move a layer. Drag numbered stroke
  points to reshape it; double-click to add a point.
- Move and resize timeline clips to change start and duration. Step by frame,
  scrub, loop, or press Space to play/pause.
- Edit color stops and curves for opacity, size, draw progress and geometry.
  Transform keyframes animate X/Y offsets, rotation and scale.
- Import PNG textures or flipbooks. Set columns/rows/frame count; textures are
  embedded in the portable `.vfx.json` project.
- Undo/redo with Ctrl/⌘ Z and Ctrl/⌘ Shift Z. Local browser autosave protects
  recent work; **Save project** downloads a file you can move or share.
- Export GIF, transparent PNG sequence, padded spritesheet, Godot SpriteFrames
  or Unity import folder directly from Studio. Export ZIPs include the project.

Open/Save use browser files. A project passed to `vfx studio file.vfx.json` is
loaded into the editor; downloading does **not** overwrite that disk file.
Browser autosave is specific to the browser and origin/port.

## Terminal

```bash
vfx new slash.vfx.json --preset red_magic_cross --seed 42
vfx studio slash.vfx.json --open
vfx set slash.vfx.json --layer cut-a --set '{"position":{"x":70}}'
vfx preview slash.vfx.json --time 0.4 --out preview.png
vfx export slash.vfx.json --format gif --scale 3 --out slash-gif --progress
vfx export slash.vfx.json --format godot --out slash-godot
```

See the [rendered sword GIF](examples/red-magic-cross.gif).

Use `vfx presets`, `vfx schema layer` and `vfx --help` to explore. Commands return
JSON; progress goes to stderr. Files live inside `--root` (defaults to cwd).
Output names must be unused; parent folders must exist. Edits validate before
publication, use an exclusive file lock and atomic replacement, and support
`--if-match REVISION` from `inspect`. MCP mutations require that revision.

## Write your own effect in TypeScript

```ts
import { defineEffect, path, curve, colors } from "vfx-maker";

export default defineEffect({
  name: "My slash",
  layers: [
    path({
      id: "cut",
      name: "Blade trail",
      points: [
        { x: -40, y: 30 },
        { x: 0, y: -10 },
        { x: 40, y: -30 },
      ],
      width: curve(8, 4, 0),
      colors: colors("#ffffff", "#ff2459"),
      glow: { strength: 1.4, blur: 3 },
    }),
  ],
});
```

```bash
vfx build my-effect.ts --out my-effect.vfx.json
vfx studio my-effect.vfx.json --open
```

`build` executes **trusted local TypeScript**, with normal Node access. It is
not exposed as an MCP tool. Modules can generate shapes, parameters and layers
using ordinary code; saved projects contain data and can be opened without
executing code. See [customization](docs/CUSTOMIZATION.md).

## Codex / Claude through MCP

```bash
codex mcp add vfx -- /absolute/path/to/vfx-mcp --root /path/to/effects
```

For clients with `mcpServers`, merge this entry into their settings:

```json
{
  "mcpServers": {
    "vfx": {
      "command": "/absolute/path/to/vfx-mcp",
      "args": ["--root", "/path/to/effects"]
    }
  }
}
```

17 tools cover templates, schemas, portable projects, direct layer updates,
embedded assets, inline image previews, exports and cancellable background
jobs. The official MCP SDK is used; stdout carries only the protocol.
Read the [agent workflow](docs/MCP.md).

## Development and migration

```bash
npm run dev           # Vite + React hot reload
npm run typecheck
npm test             # simulation, validation, storage and jobs
npm run build
npm run test:e2e      # actual Chromium UI/pixels/exports/CLI/MCP
npm run format:check
```

Set `VFX_CHROMIUM_PATH` for browser tests when needed. CI installs Playwright
Chromium and its Linux dependencies. `scripts/render-gallery.mjs` produces a
full local gallery using the actual Pixi renderer.

0.4 is a **new layer-based engine and project format**. Rust 0.3 source,
recipes, original tests and documentation are preserved under
[legacy/rust](legacy/rust). Old `.vfxproj` files are detected and rejected with
migration guidance; they are not silently approximated. New presets are
re-authored and pixels/RNG semantics differ. See [migration and feature
differences](docs/MIGRATION.md), [architecture](docs/ARCHITECTURE.md),
[release notes](docs/RELEASE_0.4.0.md) and [third-party notices](THIRD_PARTY_NOTICES.md).
