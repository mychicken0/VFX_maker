# VFX Maker 0.6.0

Studio can now edit a connected disk project through Save/Save As, with revision
checks, five retained file versions and an unsaved-work recovery choice. Native
browser handles are remembered where supported; import/download remains
available in other browsers.

Multi-selection and flat named groups support shared translation, rotation,
scale, blend, opacity and visibility. Timeline keys can be inserted and dragged
directly, with frame snapping and numeric easing/value/time edits. Adjacent-frame
onion skin and a playback loop range help inspect timing.

Freehand creates editable strokes. Cubic Bezier tangents and rectangle, ellipse
or polygon masks add custom geometry. Reference PNGs can be positioned above or
behind the effect; they remain separate from rendered/exported content.

The standalone CLI and MCP expose group/selection transforms, keyframe insertion
and backup listing/restoration. MCP now provides 26 tools. Public core helpers
share the same validation and geometry as Studio. Projects from 0.4/0.5 open
without modifying the disk file until saved.

See [Studio workflows](STUDIO.md), [MCP](MCP.md) and
[verification](VALIDATION_0.6.0.md) for behavior, limits and test evidence.
