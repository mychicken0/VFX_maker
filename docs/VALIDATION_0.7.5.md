# 0.7.5 release validation

The UI review follows real workflows, including an empty effect, rather than
counting visible buttons. Tested platform: Linux, Node 24, Chromium/SwiftShader.

- Searchable Add creates a Ring from an empty file, applies an Outline, edits its
  thickness, adds a Number, duplicates/deletes it and restores it with Undo.
- Shift+A works after the workspace opens. Sprite explains the missing PNG;
  control/layer/modifier limits produce explicit availability reasons.
- A real output/input drag makes a parameter wire; changing mode/factor changes
  the resolved layer. Layout positions save/reload and narrow layouts stay usable.
- Real pointer input on rendered gizmos translates a layer, rotates a ring,
  independently scales one axis, cancels with Escape and undoes. A source effect
  pixel is clicked to select a layer while another plane is hidden.
- Native scene viewport dimensions exceed the source pixel resolution. Grid is
  off initially. Orbit changes the editor view without writing camera metadata.
  Explicit camera alignment saves; exact camera pixels match exported PNG RGBA.
- GIF export downloads actual files, cancellation works, and 390px controls fit.
- Actual stdio MCP reads the shared catalog, previews no-write edits, commits them,
  adds a modifier/control/placement, runs reverse-order pixel parity and exports.
- Existing suites retain 2D drawing, Bezier/curve edits, canvas handles, timeline
  resize/zoom, file recovery/backups, layer groups, modifiers, 64 layers, multi-file
  batches, numeric QA, output palettes and installed CLI/MCP workflows.

The automated suite has 84 unit tests and 82 browser/CLI/MCP scenarios. Final logs
and the exact source commit are recorded in the release's hosted CI. Installed
checks use a packed build outside the checkout. Studio ZIP launchers are tested
on first install and second launch from a fresh path with spaces/Thai characters.

[Catalog agent example](../examples/catalog-agent/README.md) stores actual edits,
project, graph, source-preserving draft, committed image, QA baseline, transcript,
GIF and Godot export. The images and real-workflow screenshots are opened for
visual review. Exact pixel parity proves repeatability, not artistic quality.

This is camera staging of animated planes, not volumetric simulation. Windows /
macOS launchers, external model GUI image forwarding and Godot editor import have
not been tested on those systems. See [Stage](STAGE.md) and [Blueprint](BLUEPRINT.md)
for the implemented scope and controls.

Reproduction:

```bash
npm run format:check
npm run check
node scripts/verify-catalog-agent.mjs /path/to/new-agent-session
node scripts/render-workspace-tour.mjs /path/to/new-tour
npm pack --ignore-scripts
node scripts/package-release.mjs /path/to/release-assets
```
