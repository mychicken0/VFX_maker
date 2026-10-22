# VFX Maker 0.5.0

Small windows previously forced a 1000px-wide page and could hide Export.
The editor now fits the viewport, uses drawers on narrow screens, and supports
resizable/collapsible panels with persistent layout. A 512px canvas fits the
preview automatically. Ctrl/⌘ wheel zooms around the pointer, Hand/middle mouse
pans, and Grid/Snap support precise pixel editing.

Pixel optimizer adds actual before/after previews, byte savings, lossless PNG
recompression, color/alpha reduction, nearest-neighbor resize and block pixels.
It runs locally in a cancellable worker. Texture replacement validates the
existing flipbook grid. Output settings travel in project data and apply to
all five export formats. Shared animation palettes avoid independent per-frame
color changes. Configurable atlas padding and optional edge extrusion preserve
exact straight RGBA through exported borders.

Recolor changes all/selected gradient and tint hues with a rendered preview,
retaining shading and making one undoable edit. Whole-composition resize scales
positions, motion, layer geometry and glow together, or only changes bounds.
Layer search, raise/lower, solo preview, duplicate naming and keyboard nudging
reduce repetitive edits. Eight named local project backups support recovery.
Modal focus is trapped, background shortcuts are blocked, and pointer-cancel
reverts an unfinished drag. Cached serialization keeps playback from repeatedly
serializing embedded texture data. Undo history has count and byte budgets.

Terminal adds `optimize`, `optimize-asset`, `resize` and `recolor`. The stdio MCP
server exposes the same operations through 21 tools. PNG optimization works
without Chromium; preview/export use the actual PixiJS renderer. Existing
0.4.0 project data opens with current defaults without rewriting the source file.

Reference review covers PixelLab's public page/bundle and seven freely licensed
projects, with exact source commits and integration boundaries documented in
[OPEN_SOURCE_RESEARCH.md](OPEN_SOURCE_RESEARCH.md). Current source, docs, startup
instructions, notices and package metadata describe the 0.5.0 application.

Validation on Linux, Node 24 and Chromium/SwiftShader: core/storage/pixel tests;
actual browser rendering, all presets, window sizes down to 390px and short
landscape windows; focus, cancellation, resize/recolor, worker outputs, palette
and alpha invariants, edge extrusion, export metadata/checksums, CLI in a Thai
path with spaces, and the official MCP SDK client. Full results and measurements
are recorded in [VALIDATION_0.5.0.md](VALIDATION_0.5.0.md).
