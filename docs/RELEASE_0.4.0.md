# VFX Maker 0.4.0

Rebuild the customization workflow around a local React + PixiJS studio. Effects
are editable compositions of particles, strokes, rings and textured sprites.
The browser, CLI and MCP share schemas, sampling and rendering.

New authoring features include direct point dragging, visual layer ordering,
timeline retiming, curve/keyframe editing, gradients, transform animation,
embedded flipbooks, undo/redo, local autosave and browser ZIP exports. A typed
TypeScript API generates new project data without node graphs or engine rebuilds.

The standalone npm package exposes `vfx`, `vfx-mcp`, the authoring API and renderer.
17 MCP tools support revision-checked edits, inline previews, synchronous exports
and managed cancellation. PNG/GIF/Godot/Unity formats carry timing and portable
project data. Eighteen examples are re-authored on the new engine.

This release changes runtime dependencies, project format, metadata, simulation
and pixel semantics. Read MIGRATION.md before replacing 0.3 workflows. Chromium
is needed for headless export; the package has not been published to npm. Linux
Chromium/SwiftShader is the tested target. Other operating systems, external
agent GUI sessions and Unity Editor execution are not validated.

Validation: 15 core/storage/job tests and 10 Chromium end-to-end tests pass.
The latter cover all 18 effects, pixel/alpha/flipbook/keyframe assertions, UI
dragging/history/autosave, GIF timing, all five exports, external-directory CLI
and the official MCP client with successful and cancelled jobs. The relocated
Rust workspace still passes its 60 integration tests. Godot 4.5.1 loads the new
resource and validates a three-frame 0.21-second animation, including its partial
last frame. Runtime npm audit reports zero known advisories at verification time.
