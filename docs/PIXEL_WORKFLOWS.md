# Pixel workflows

## Studio

Pause on a frame and open **Pixel optimizer**, or use **Optimize PNG** on an
embedded texture. **Open PNG** accepts a separate image. The before/after slider
uses the actual processed file. Dimensions, visible RGB counts, bytes and
percentage change describe the result that **Download PNG** saves.

Start with **Reset to lossless**. This recompresses without changing decoded
RGBA pixels, including partial alpha and RGB hidden under transparent pixels.
If the original encoding is smaller, it is kept. Lossless here describes pixel
data; metadata can be stripped. Use PNG already in sRGB without compressed
metadata. APNG, 16-bit inputs, nonstandard gamma and oversized inputs are
rejected with an actionable error.

Lower **Color limit** to reduce the visible RGB palette; 0 keeps all colors.
**Ordered dithering** can soften palette banding using a deterministic 4×4
pattern. **Alpha levels** controls transparency separately; 0 preserves it.
**Output scale** samples nearest pixels, and **Pixel block size** groups output
pixels without interpolation. These changes are labeled lossy. Upscaling or
retaining detailed alpha can increase bytes; the tool reports that too.

**Use settings for exports** saves processing settings in the project. Preview
editing continues at the canvas resolution; exports use the chosen output
settings. All formats support fractional scale, including spritesheets, Godot
and Unity. GIF composites on the canvas background; PNG keeps transparency.
Animation frames share their RGB palette. Atlas **Extrude edges** repeats the
nearest frame edge through padding without changing the frame rectangles.

**Replace texture** changes only that asset and is one undoable operation.
Columns, rows and frame count remain intact. A new size must still divide by
the existing grid; otherwise the project stays unchanged. Replacement is also
subject to the 1 MiB embedded PNG, one-million combined texture pixels and
4 MiB project limits.

## Terminal

```bash
vfx optimize input.png --out lossless.png
vfx optimize input.png --out pixel.png --scale 0.5 --colors 16 --dither
vfx optimize input.png --out blocks.png --pixel-size 2 --alpha-levels 4
vfx optimize-asset effect.vfx.json sheet --colors 32 --scale 0.5
vfx resize effect.vfx.json --width 64 --height 64 --mode scale
vfx recolor effect.vfx.json --hue 120 --layers cut-a,cut-b
vfx export effect.vfx.json --format spritesheet --out packed --scale 0.5 --colors 16 --padding 3 --extrude
```

PNG optimization uses Node directly. Rendering exports requires Chromium.
File paths are confined to `--root`, outputs must be unused and parent folders
must exist. Project edits support `--if-match` and validate the complete result.

## Limits

PNG inputs: at most 4 MiB, 1024px per side and one million pixels. Optimizer
output: up to 4096px per side and four million pixels. Export: 300 frames,
16 million source pixels, 16 million output pixels for PNG formats or 32 million
for GIF. Atlas: at most 8192px per side and 32 million pixels including padding.
Budgets are checked before large allocations. Cancel closes stale optimizer
workers or aborts export between frame-processing steps; a single synchronous
PNG encode finishes before a UI cancellation event can be handled.
