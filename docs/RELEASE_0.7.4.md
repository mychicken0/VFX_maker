# VFX Maker 0.7.4

A canvas-first human editor and an AI-native authoring tool, released under MIT.

- Larger fit preview, folded Library and optional settings, 12px minimum UI text
  with Larger/Extra large choices, more visible panel resize handles.
- Direct Move/Scale/Rotate tools, larger point/tangent targets, cursor-centered
  wheel zoom, plus/minus buttons, pan and shortcuts. Multiple selected layers
  transform together; drag cancellation and single-step undo are preserved.
- Pen paths, Insert/Delete/Smooth/Corner point editing, exact point coordinates,
  thickness control and real draggable Inspector curves.
- Timeline height beyond the old 400px cap, 100–1600% horizontal time zoom,
  scrolling, fit and always-available timeline focus/restore.
- Blueprint: add numeric controls, connect typed layer inputs by drag or form,
  edit wire modes/factors/offsets, inspect modifier chains and live output, save
  node positions. It uses the same project controls and renderer as CLI/MCP.
- Separate **2.5D / 3D Stage**: isometric/perspective camera, orbit,
  ground/upright/billboard planes and per-layer placement, saved with the project.
  Camera-baked GIF/PNG/game exports omit preview guides. Ordinary 2D stays the
  initial editor; camera controls live only in Stage.
- MCP has 40 tools. New `get_stage` discovers camera/placements; shared edits,
  draft stage previews, parity QA and exports support `view:"stage"`. CLI exports
  accept `--view stage`. New `get_blueprint` describes valid ports/connections without
  starting a browser; `apply_edits` adds connect/disconnect and path-point edits.
  Draft observation, revisions, backups, atomic batches and numeric QA still apply.
- MIT LICENSE, exact dependency notices, public source, and a Studio ZIP with local
  launchers alongside the installable npm archive. Node.js is still required.

The Blueprint editor routes numeric controls to existing parameters. Green image
wires explain the fixed modifier/composition order; arbitrary image rewiring,
control-to-control expressions and a general node language are not included.

See [research](RESEARCH_0.7.4.md), [Blueprint](BLUEPRINT.md),
[Stage guide](STAGE.md), [Studio guide](STUDIO.md) and [validation](VALIDATION_0.7.4.md).

Stage projects textured 2D effect layers through a real camera. Volumetric XYZ
particle simulation and 3D engine scene export are outside this release.
