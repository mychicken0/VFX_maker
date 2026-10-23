# Camera-stage examples · 0.7.4

Both are real stdio MCP sessions using the same editable 2D layers and camera
renderer as Studio. No imported 3D models or external effect assets are used.

| Isometric healing field | Crimson cross in depth |
| --- | --- |
| ![Ground ring and raised billboard sparks](isometric-heal/animation.gif) | ![Separated sword planes above a ground ring](depth-cross/animation.gif) |
| [Editable project](isometric-heal/effect.vfx.json) · [exact edits](isometric-heal/edits.json) | [Editable project](depth-cross/effect.vfx.json) · [exact edits](depth-cross/edits.json) |

Open a project, then **2.5D / 3D** to see the saved camera. Ordinary 2D remains
available. Each folder includes a clean PNG, numeric QA baseline and camera-baked
Godot atlas/resource. The [manifest](manifest.json) records GIF and PNG hashes;
the [actual structured transcript](transcript.json) records discovery, a camera
draft with unchanged source, revisioned commit, exact draft/commit image equality,
reverse-order RGBA parity and successful background GIF/Godot exports.

```bash
node scripts/render-stage-gallery.mjs /path/to/new-output-directory
# Optionally append the installed MCP entry as the second argument.
```

The PNGs were opened for visual inspection. These are textured planes viewed
through a real camera, not volumetric particles. Engine exports contain baked
frames, not a live 3D scene. Godot editor import was not tested.
