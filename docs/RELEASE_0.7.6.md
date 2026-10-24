# VFX Maker 0.7.6

Repairs problems reproduced during actual browser and SDK/stdio workflows.

- MCP `import_asset` now accepts valid static PNGs and flipbook grids. The handler
  passes only asset options to asset validation, keeping file/revision fields out.
- 2D Add uses the same canvas-relative generators as Blueprint and MCP. Sprite
  proportions use the imported image/flipbook cell; strokes/rings/particles fit
  the composition instead of using a separate set of defaults.
- Saved components preserve Stage planes/placements with remapped layer IDs and
  keep the receiving camera. Unselected placements stay out of saved components.
  Inserted layers/controls/groups have distinct names. Saved remains available
  for repeated insertion; narrow drawers close to show the result.
- Scale-to-fit Resize transforms saved camera/world coordinates and spatial
  control bindings as well as base geometry. Canvas-only resize preserves them.
- Opening a CLI file-connection link in an existing Studio tab now establishes
  the document session when navigation changes only the URL fragment.
- Layout adapts to panel widths and text size. Short windows temporarily fold the
  timeline while retaining desktop preferences. Restore canvas returns to the
  previous folded state. Controls remain available through drawers/scrolling.

2D is the default. Stage continues to use animated effect planes and camera-baked
image exports. Blueprint retains its existing layer/modifier image pipeline.
No additional rendering dependency was introduced. 0.7.5 projects/components open.

See [audit](AUDIT_0.7.6.md), [validation](VALIDATION_0.7.6.md),
[Studio](STUDIO.md), [Stage](STAGE.md) and [MCP](MCP.md).
