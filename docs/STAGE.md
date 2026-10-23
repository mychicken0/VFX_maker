# Separate 2.5D / 3D Stage

Studio opens in its normal 2D canvas. Click **2.5D / 3D** only when you want to
place an effect in a camera scene. Closing Stage returns to the same 2D editor.

**2.5D · game view** starts with an orthographic isometric camera and ground
planes. **3D · free camera** starts with a perspective camera and upright planes.
Drag the viewport to orbit. Isometric / Front / Top set useful camera angles.
Camera span controls orthographic framing; camera distance controls perspective
framing. Projection, angles, FOV and target stay under **Advanced camera**.

Open **Place a layer** to choose a layer and ground/upright/billboard orientation,
then X/Y/Z placement. Rotation and scale stay folded. Billboard planes face the
camera. World units are original canvas pixels: +X right, +Y up, +Z world front.
The original layer canvas is centered on its plane; its existing 2D animation,
colors, masks, modifiers and textures are rendered by Pixi before projection.

Camera and placement values are saved in optional `project.stage`. Orbit is one
undoable gesture; cancellation discards the draft. Undo/Redo in the Stage toolbar
work without leaving the camera workspace. Duplicating a placed layer
copies its placement, while removal cleans up its placement. A locked layer's
placement cannot be edited. Global camera changes still affect the scene.

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
