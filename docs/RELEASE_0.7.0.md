# VFX Maker 0.7.0

This release makes effects easier to customize and reuse while keeping layer
editing as the main workflow. Projects from 0.4–0.6 open through the existing
parser and gain defaults for new fields.

## Everyday authoring

- **Make it yours:** editable Size, Intensity and Hue controls on every template.
  A drag previews the real renderer and commits once on release; one undo restores
  the previous value. Advanced bindings stay inside a disclosure.
- **Saved components:** save a selection with its assets, groups, curves, masks,
  modifiers and associated controls. Reuse it across projects or download/import
  a portable `.vfx-component.json`. IDs and asset references are remapped on insert;
  identical textures are reused. Insertions are independent editable copies.
- **Looks:** capture control values and random seed, compare actual rendered
  thumbnails, apply a look or export 1–8 looks together. The underlying layers are
  shared project data; changing them affects every look's next render.
- Technical project/export settings are collapsed by default. Name and effect
  controls remain directly accessible. Short screens retain focusable dialogs and
  existing panel drawers.

## Creating effects

- Five procedural field patterns: fractal value noise, cells, radial, box and
  stripes. Animate width, height and cutoff; adjust frequency, evolution speed,
  octaves, edge softness, edge fade and highlight color.
- Seven ordered modifiers: outline, pixel blocks, color replacement, color ramp,
  shockwave, seeded noise warp and dissolve. Enable/bypass, reorder and remove
  them without replacing the source layer. PixiJS Filters 6.1.5 supplies outline,
  pixelate, color replacement and shockwave; the other shaders are original.
- Particles can emit inside the first frame's visible PNG pixels, with a threshold
  and emission dimensions. Empty masks are rejected before saving. Particle
  trails sample past positions explicitly in emitter space, so scrubbing/export
  do not depend on playback history.
- Four additional editable examples: Ember plume, Void portal, Electric bloom
  and Glacial lance. There are 22 templates in total.

## Animation and tools

- Multi-channel dope sheet for selected layers; Shift-click selection, drag/move,
  duplicate, copy/paste at playhead, frame snapping and deletion. Invalid moves or
  removing the last key are rejected atomically.
- Auto key records position, rotation and scale changes into motion curves at the
  playhead while retaining base transforms. Existing curve editing remains.
- Timing dialog stretches a whole effect with particle dynamics compensation or
  staggers an unlocked selection. Limits still apply; extreme stretches can be
  rejected with an error instead of silently clipping values.
- Optional export start/end range; animation timestamps start at zero and metadata
  records `sourceRange`. The original complete project stays in the export.
- Preview PNGs encode the renderer's straight RGBA directly, avoiding a second
  Canvas2D premultiplication and matching unprocessed PNG export pixels exactly.
- CLI: `controls`, `control`, `creative`, `component-save`, `component-insert` and
  `export-variants`; `schema creative` describes validated operations.
- MCP adds five tools (31 total): `inspect_creative`, `edit_creative`,
  `save_component`, `insert_component`, `start_variant_export`. Existing revision
  checks, backups, file roots, immutable jobs and cancellation apply.

## Boundaries

Controls evaluate from original layer fields in stored order, never by repeatedly
mutating their previous result. Values must produce valid layers and respect
particle/trail budgets. Layer fields shown in the Inspector are source values
before controls. Hue bindings rotate gradient colors; texture pixels are unchanged.

The browser component library is limited to 24 items / 24 MiB and belongs to the
current browser origin. Portable downloads are the cross-browser backup. Looks
are control/seed snapshots; they are not linked external component files or
independent copies of a project. Batch exports allow 8 looks / 32 million source
pixels / 64 MiB of generated files. A layer permits 8 modifiers; a project permits
16 controls, 12 looks and 16,000 particle trail segments per cycle.

See [open-source adaptations](OPEN_SOURCE_RESEARCH.md),
[customization](CUSTOMIZATION.md), and [validation](VALIDATION_0.7.0.md).
