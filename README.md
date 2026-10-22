# VFX Maker 0.6.0

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

Or install the prepared `vfx-maker-0.6.0.tgz` once and use it in any folder:

```bash
npm install -g /path/to/vfx-maker-0.6.0.tgz
cd /path/to/your/game
vfx studio --open
```

Source installer: `bash /path/to/VFX_maker/scripts/install.sh /path/to/tools`;
add `/path/to/tools/bin` to PATH. The installed package includes the built editor
and renderer; it does not need this checkout or a game repository.
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
- Ctrl/⌘-click or Shift-click to select layers, then group them. Move the
  selection in the canvas or apply translation, rotation, scale, blend and opacity
  together. Locked layers are skipped unless explicitly included.
- Draw **Freehand** strokes or enable **Bezier** tangents on existing strokes.
  Layer masks clip to a rectangle, ellipse or editable polygon, including glow.
- Move and resize timeline clips. Open **Keyframes**, choose a channel and
  double-click/drag keys directly; frame snapping, numeric values and easing are
  editable. Use **Onion** for adjacent frames and **Loop range** for a work area.
- Import a character or scene under **Reference**, then position it, change its
  scale/opacity and place it behind or above the effect. It remains preview-only.
- Edit color stops and curves for opacity, size, draw progress and geometry.
  Transform keyframes animate X/Y offsets, rotation and scale.
- Import PNG textures or flipbooks. Set columns/rows/frame count; textures are
  embedded in the portable `.vfx.json` project.
- Fit the canvas, pan with Hand or middle mouse, zoom around the pointer with
  Ctrl/⌘ wheel, and toggle pixel grid or snapping. Panels resize, collapse and
  remember their layout; narrow windows use side drawers.
- Recolor all or selected layer gradients/tints together, with a real preview
  and one-step undo. Locked layers are skipped by default.
- Resize the composition uniformly to fit a new canvas, or crop/expand only
  the canvas. Raise/lower, solo-preview, search and keyboard-nudge layers.
- Open **Pixel optimizer** to compare a frame or PNG before/after. Recompress
  losslessly, reduce colors/alpha levels, resize with nearest-neighbor sampling,
  or make larger pixel blocks. Download PNG, replace a texture or reuse the
  settings on every export format. Actual byte savings are shown.
- Undo/redo with Ctrl/⌘ Z and Ctrl/⌘ Shift Z. Browser autosave restores recent
  edits after a close; **Recent** retains eight project snapshots. **Save** writes
  a connected disk file, **Save As** changes the target, and **File backups**
  restores one of the last five distinct file versions.
- Export GIF, transparent PNG sequence, padded spritesheet, Godot SpriteFrames
  or Unity import folder directly from Studio. Output scale works in every
  format; atlas padding and optional edge extrusion support game textures.
  Palettes are shared across animation frames. Export ZIPs include the project.

**Saving:** `vfx studio file.vfx.json` connects Save to that file with SHA-256
revision checks and backups in its `.vfx-backups` directory. Chromium browsers
can also remember a file chosen with the native Open/Save As picker; backups go
to IndexedDB. Other browsers fall back to file import/download. **Project menu →
Download project** always creates a portable copy. Recovery offers unsaved work
or the disk version when reopening a connected document. Browser storage and
remembered handles are specific to the profile and origin/port, and can be
removed by clearing site data. See [saving and authoring](docs/STUDIO.md).

## Terminal

```bash
vfx new slash.vfx.json --preset red_magic_cross --seed 42
vfx studio slash.vfx.json --open
vfx set slash.vfx.json --layer cut-a --set '{"position":{"x":70}}'
vfx preview slash.vfx.json --time 0.4 --out preview.png
vfx export slash.vfx.json --format gif --scale 3 --out slash-gif --progress
vfx export slash.vfx.json --format godot --scale 0.5 --out slash-godot
vfx optimize preview.png --out small.png --colors 16 --scale 0.5
vfx resize slash.vfx.json --width 64 --height 64
vfx recolor slash.vfx.json --hue 120
vfx group slash.vfx.json --id attack --name Attack --layers cut-a,cut-b
vfx transform slash.vfx.json --layers cut-a,cut-b --x 4 --scale 0.8
vfx keyframe slash.vfx.json cut-a motion.x --time 0.5 --value 12 --ease smooth
vfx backups slash.vfx.json
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
executing code. See [customization](docs/CUSTOMIZATION.md) and the runnable
[Bezier/mask/group example](examples/bezier-slash.ts).

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

26 tools cover templates, schemas, portable projects, layer/group transforms,
keyframes, backups and restoration, direct layer updates,
embedded assets, inline image previews, PNG optimization, canvas resizing,
recoloring, exports and cancellable background jobs. The official MCP SDK is used; stdout carries only the protocol.
Read the [agent workflow](docs/MCP.md).

## Development

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

## Pixel output and research

Default PNG recompression preserves decoded RGBA and keeps the original encoding
when it is smaller. Palette, alpha, block and scale changes are lossy; the UI
labels them explicitly. GIF uses an opaque matte. PNG input is static, up to
1024 × 1024 and 4 MiB; embedded assets are limited to 1 MiB. Compressed metadata,
16-bit PNG and non-sRGB gamma are rejected by the optimizer. Metadata may be
stripped during recompression. PNG optimization does not require Chromium.

See [pixel workflows](docs/PIXEL_WORKFLOWS.md),
[open source/product references](docs/OPEN_SOURCE_RESEARCH.md),
[0.6.0 changes](docs/RELEASE_0.6.0.md),
[validation](docs/VALIDATION_0.6.0.md),
[previous pixel measurements](docs/VALIDATION_0.5.0.md), and
[project compatibility](docs/MIGRATION.md).
