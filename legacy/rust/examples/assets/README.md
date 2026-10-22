# Original example textures

These small textures are authored for this tool, with no third-party source assets.
Projects embed the PNG bytes, so the source files are unnecessary at runtime.

- spark.png: 17×17 white alpha sprite, suitable for tinting and rotation.
- blast-flipbook.png: six 24×24 frames, in a 3-column ×2-row grid, row-major order.
- portal-mask.png: 64×64 white radial alpha mask with an open center.

Use `vfx asset import PROJECT --file examples/assets/blast-flipbook.png --id blast
--columns 3 --rows 2 --frames 6 --expected-revision N` when the asset file and
project are inside the chosen --root. Inspect revision first. The original
project's distribution license remains unspecified, as described in notices.
