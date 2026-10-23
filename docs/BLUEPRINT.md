# Blueprint: people and agents edit the same effect

Open **Blueprint** in Studio. The canvas workspace remains the simple default.
The graph starts with the chosen layer to keep nodes readable; choose **All layers**
for the complete composition. A live effect preview remains beside the graph.

A **Number control** has one purple value output. A layer exposes numeric/curve/hue
input ports. Drag the output to a port or use **Connect parameters** for a keyboard
accessible alternative. **Show input port** exposes any field from the validated
parameter registry. Connecting already-connected ports is rejected.

Click a purple wire to change its mode, factor and offset or **Disconnect** it.
The input amount is `control.value * factor + offset`:

- **Multiply** multiplies the base field or every value of a curve.
- **Add** adds the amount to the base field or each curve value.
- **Set** replaces that value. A Set binding can hide edits made to the base field.

Hue inputs rotate hue; use Recolor's Set gradient to tint gray source colors.
Controls run in project order. Their current evaluated result must satisfy layer
and resource limits; choosing a connection or value that violates them fails and
keeps the previous effect. A control's entire slider range is not pre-certified.

Select a control node to edit its name and min/max or remove it. Select a layer or
modifier node for its **Modifiers** panel. Green dashed image wires show the
renderer order: layer → ordered modifiers → composite output. They are informative,
not rewirable image sockets. Reorder/bypass/remove modifiers in that panel.
There are no arbitrary expressions, control-to-control links or graph cycles.

Drag node headers to organize them; **Fit nodes**, pan/zoom and the minimap navigate.
Node positions are saved in `editor.blueprint`, separate from effect coordinates.
They survive project save/reopen and undo. Deleting a control removes its bindings
and variant values, while a disconnected wire leaves its control available.

**AI/MCP** uses this same data, without operating UI pixels:

```json
{ "tool": "get_blueprint", "arguments": { "file": "effect.vfx.json" } }
```

The result includes revision, control IDs/order, node IDs, typed input paths,
connections, lock state, modifier chains and ready-to-use disconnect edits. It
omits image asset payloads and needs no browser. Then use `apply_edits`:

```json
{
  "file": "effect.vfx.json",
  "revision": "REVISION_FROM_GET_BLUEPRINT",
  "edits": [
    {
      "action": "creative",
      "operation": {
        "action": "put_control",
        "control": {
          "id": "turn",
          "name": "Turn",
          "min": -180,
          "max": 180,
          "value": 45,
          "step": 1,
          "bindings": []
        }
      }
    },
    {
      "action": "connect_control",
      "control": "turn",
      "layer": "LAYER_ID_FROM_GRAPH",
      "target": "rotation",
      "mode": "add"
    }
  ],
  "dryRun": true
}
```

Feed the same edits, file and revision to `observe_project` for a draft PNG before
committing. Remove `dryRun` from `apply_edits` to write one validated transaction
and backup. Re-observe and run `analyze_project` for numeric parity/baseline QA.
A binding's `index` is valid only for its observed revision; stale mutations fail.

`edit_path_point` adds/removes/smooths/corners an anchor while keeping optional
Bezier handles aligned. For coordinates use `set_path_points` with explicit
local/canvas/normalized space; port/curve discovery uses `get_schema` and
`get_blueprint`. Existing creative operations still edit controls and modifiers.
