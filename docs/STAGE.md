# Separate 2.5D / 3D Stage

Studio opens in its normal 2D canvas. Click Choose **2.5D** for a ground-oriented game view or **3D** for upright planes and
perspective. The default 2D editor stays separate. **Scene** provides the editing
view; **Camera preview** shows the actual saved camera output at export pixels.

Select a layer from **Layers**, or click a visible effect pixel. Choose **Move / G**,
**Rotate / R** or **Scale / S**, then drag a colored axis handle. Position/rotation
and independent scale are editable under **Properties** as well. Shift during a
gizmo drag snaps position to whole world pixels, rotation to 15°, and scale to 0.1.
Each completed transform is one undo; Escape or pointer cancellation discards it.
Locked/hidden layers do not expose a transform handle.

**Middle drag** or **Alt+left drag** orbits. **Shift+middle drag** pans; wheel zooms.
The **Orbit** tool also lets left drag orbit. **F** frames selected, **Shift+F**
frames all. Front / Right / Top / Iso and numpad 1 / 3 / 7 / 5 set useful views.
Scene navigation changes only your editing view. **Use view for export** explicitly
aligns the saved output camera, then shows its pixel preview. Output lens/target
fields live under **Export camera settings**. A ground plane is edge-on in Front;
use Top/Iso or change its orientation.

**Grid** starts off. It is a subtle editor guide at screen resolution; handles and
selection outlines are also screen-resolution helpers. They never enter exports.

**+ Add layer** creates a layer using the shared catalog. Duplicate copies its
bindings and placement; Delete removes its placement too. World units are original
canvas pixels: +X right, +Y up, +Z world front. Planes can be ground, upright or
billboard; billboards face the camera. Original layer animation, colors, masks,
modifiers and textures render before projection. Placement lives in `project.stage`:
`position`, local Euler `rotation`, uniform `scale`, and per-axis `stretch`.

Play/scrub here to inspect animation. **Export camera** bakes the saved camera to
a GIF, spritesheet, PNG sequence, Godot SpriteFrames resource or Unity sheet.
Grid and axes are preview-only. Output size, palette and alpha follow the existing
export pipeline. The embedded editable project retains the camera. Normal 2D
exports remain available with `view:"effect"` (the default) and have unchanged
pixels when only stage data changes.

This is a real 3D camera scene of textured effect planes. It is not a volumetric
XYZ particle simulator or a 3D mesh/particle engine export. Normal/additive layer
blending is supported in Stage; other layer blend modes use alpha compositing.
Transparency/depth order can differ from flat 2D composition. Use the camera
preview and parity QA to inspect the intended baked result.

## MCP / CLI

1. `get_stage {file}` returns the current revision, camera, world conventions and
   layer IDs. `get_schema {kind:"stage"}` / `stage_placement` lists exact fields.
2. `apply_edits` supports `configure_stage {patch}` and
   `place_stage_layer {id,patch}`. Nested placement fields merge, so setting Z does
   not reset X/Y. Defaults are supplied for a project without Stage data.
3. Preview an uncommitted camera with
   `render_preview {file,revision,edits,view:"stage",time:0.3}`. Source bytes do not
   change; result/image metadata marks the draft. Commit the same edits/revision.
4. `analyze_project {file,view:"stage",times:[0.2,0.3,0.5]}` hashes the projected
   RGBA and rerenders in reverse order. Stage/2D baselines are distinguished.
5. Use export `options:{view:"stage",format:"gif"}` with the normal revisioned
   background export jobs or multi-project batches.

```bash
vfx preview effect.vfx.json --view stage --time 0.3 --out camera.png
vfx analyze effect.vfx.json --view stage --times 0.2,0.3,0.5
vfx export effect.vfx.json --out camera --view stage --format godot
```

A stage preview with no time uses a timing estimate rather than an exhaustive
visibility scan. For framing QA choose explicit times and inspect returned alpha
bounds. Stage rendering processes each visible source layer; preflight adds a
67,108,864 layer-pixel work cap across frames, in addition to existing output
limits. Reduce layers, dimensions, FPS or duration if it is exceeded.
