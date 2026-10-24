# VFX Maker 0.7.5

Repairs the authoring workflow in Blueprint and the camera stage while keeping
ordinary 2D editing as the default.

- **Add** in Blueprint opens a searchable catalog: Particles, Stroke, Ring, Sprite,
  Texture, seven modifiers and Number control. Shift+A and right-click open it.
  Missing assets/limits have visible reasons. New nodes are selected, placed with
  room and shown at readable zoom. Delete, duplicate, undo and node properties work.
- New Number controls support useful values such as rotation 90°. Scalar wires
  default to Set; curves/scale default to Multiply. Wire properties remain editable.
- Stage has a native-resolution scene viewport, outliner, alpha picking and real
  Move/Rotate/Scale axis handles. Transforms support cancellation and one-step
  undo. Independent X/Y/Z scale is saved alongside uniform scale.
- Middle-drag or Alt+drag orbits, Shift+middle-drag pans, wheel zooms, F frames.
  Scene navigation is independent from the saved export camera. **Use view for
  export** aligns it; **Camera preview** displays the actual baked pixels.
  Grid is off initially and draws subtly when enabled.
- Duplicate preserves parameter bindings and plane placement. Errors appear above
  the workspace, and Add shortcuts work immediately after opening Blueprint.
- MCP `get_node_catalog` returns the same Add entries, availability and validated
  example edits. The existing revisioned draft/commit/QA/export workflow applies.
  There are 41 tools. Old 0.7.4 projects remain readable.

The Stage continues to render 2D animated effect planes in a 3D camera scene.
Exports are baked game frames; volumetric particles and mesh exports are outside
this release. The Blueprint image pipeline follows layer/modifier order;
arbitrary image rewiring and a general expression language are outside its scope.

See [Stage](STAGE.md), [Blueprint](BLUEPRINT.md),
[interaction research](RESEARCH_0.7.5.md) and [validation](VALIDATION_0.7.5.md).
