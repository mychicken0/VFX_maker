# Interaction research and source audit · 0.7.5

Reviewed the official Blender keymap, commit
[445db6c5f6399dda622d4d58664e99064a41babf](https://github.com/blender/blender/tree/445db6c5f6399dda622d4d58664e99064a41babf):
[scripts/presets/keyconfig/keymap_data/blender_default.py](https://github.com/blender/blender/blob/445db6c5f6399dda622d4d58664e99064a41babf/scripts/presets/keyconfig/keymap_data/blender_default.py).
The `km_view3d` and `km_node_editor` sections define middle-button orbit,
Shift+middle pan, frame selected, G/R/S transforms, Shift+A Add, delete and duplicate.
Reviewed the upstream COPYING file. Blender is GPL licensed; it is an interaction
reference. No Blender implementation, UI artwork or assets were copied into this
MIT application. The official source was inspected rather than claiming a full
installed Blender benchmark.

Concrete VFX Maker problems found:

- Stage rendered guides and effect at the export's 128px size and enlarged the
  entire canvas. This made guides coarse and dominant. The scene now draws at
  viewport resolution, while a separate renderer provides exact pixel output.
- Every pointer drag orbited the saved export camera. The scene view is now
  ephemeral; alignment to the saved camera is explicit.
- A layer could only be placed through folded numeric fields. Outliner/alpha
  picking and Three.js TransformControls provide direct movement, rotation and
  axis scaling. OrbitControls supplies navigation; both are from the already
  pinned MIT Three.js dependency. No new package was added.
- Blueprint's Add only made a narrow-range number. A shared catalog now creates
  five editable layer types, seven modifiers and number controls. Search,
  Shift+A, availability reasons, context selection, delete, duplicate and field
  editing make an end-to-end authoring path possible.
- Graph fit ran around creation, nodes could overlap after hidden layers appeared,
  and control selection could become stale. Creation reserves space, selects and
  reveals the new node at readable zoom; graph fit is explicit after the initial
  view. New controls accept a useful numeric range. Scalar input connections use
  Set, while curves/scale default to Multiply to preserve profiles.
- Add shortcuts initially depended on focus being inside the graph. They now
  work when the dialog's close button holds focus after opening, and Escape
  closes Add without closing the workspace. Existing declarative background
  inert handling remains owned by Studio so closing a dialog restores input.

Evidence includes real mouse drags on rendered gizmos, an effect built from an
empty project through Add, numeric field edits, undo/cancel, camera alignment,
PNG parity, narrow layouts and stdio MCP discovery/draft/commit/export.
Tests are a regression guard. Screenshots of those workflows are opened and
reviewed as part of release validation; button presence alone is insufficient.
