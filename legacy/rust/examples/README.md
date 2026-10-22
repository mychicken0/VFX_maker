# Render an effect without effect-specific code

Run in any existing asset folder with installed `vfx`:

```bash
vfx new sword.vfxproj --preset red_magic_cross --canvas 96x96 --seed 42
vfx export sword.vfxproj --format gif --fps 25 --scale 5 \
  --background '#100811' --out sword-gif
vfx export sword.vfxproj --format spritesheet --fps 25 --out sword-atlas
```

Change the recipe, seed or declared parameters using `vfx preset list` and
`vfx preset show ID`. To build a new reusable effect, save a recipe copy with
`preset show ID --out custom.recipe.json`, edit its data and use
`new --preset-file custom.recipe.json`.

For an offline gallery of every catalog entry, use the generic batch client:

```bash
python3 /path/to/VFX_maker/scripts/render_gallery.py \
  --vfx /absolute/path/to/vfx --out /new/gallery
```

This script discovers IDs and uses the same CLI for each. It contains no
per-effect drawing or authoring branches. Core runtime and GIF export need no
Python or FFmpeg.

## Textured and timed effects

```bash
vfx new charge.vfxproj --preset charge_impact
vfx preview charge.vfxproj --times 0.2,0.5,0.8,1.0 --out charge.png
vfx export charge.vfxproj --format gif --fps 25 --scale 4 --out charge-gif
vfx new portal.vfxproj --preset masked_portal
vfx export portal.vfxproj --format godot --fps 25 --out portal-godot
vfx export portal.vfxproj --format unity --fps 25 --out portal-unity
```

Original input textures are in [assets](assets/README.md). Frozen visual examples
are in [rendered](rendered/README.md). The [production guide](../docs/PRODUCTION_WORKFLOW.md)
explains importing your own sheet, material/timeline controls, post-processing,
revisioned editing and cancellable MCP jobs. A reproducible performance fixture
is described in [performance measurements](../docs/PERFORMANCE.md).
