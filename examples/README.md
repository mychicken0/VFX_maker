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
