# MCP workflow

The stdio server is `vfx-mcp --root /absolute/path/to/effects`. The host launches
it; no persistent HTTP service is needed. Chrome/Chromium must be discoverable
for rendering. File editing and schemas do not require a running browser.

## Host setup

Use the installed executable's absolute path so the host works from any folder.
The effect folder must already exist. Restart/reconnect the host after upgrading
the package so it discovers the new tools and server instructions.

```bash
codex mcp add vfx -- /absolute/path/to/vfx-mcp --root /path/to/effects
claude mcp add --transport stdio vfx -- /absolute/path/to/vfx-mcp --root /path/to/effects
```

For hosts using a JSON `mcpServers` configuration:

```json
{
  "mcpServers": {
    "vfx": {
      "command": "/absolute/path/to/vfx-mcp",
      "args": ["--root", "/path/to/effects"]
    }
  }
}
```

If Chromium is not discoverable, add `VFX_CHROMIUM_PATH` to the host entry's `env`
or install it with `vfx browser install`. `vfx doctor` reports browser discovery.
A useful first task is: “Observe a storyboard, inspect layer positions, preview
your edits as a draft, commit them and verify the final image. If images are
hidden, save a PNG for your image viewer and explain any remaining limitation.”

## Preferred workflow

1. Start with `capabilities` and `list_presets`, then `new_project` from a preset or validated project.
2. Prefer `observe_project {file, view: "storyboard"}` to inspect motion. It returns
   a real annotated PNG, `structuredContent`, text JSON and image resource links.
   `scene` includes IDs, coordinates, actual pixel bounds, controls and timing.
3. View the returned image when your host supports vision. If it hides images,
   read an `images[].uri` through MCP resources, or call `save_preview` to a fresh
   PNG and use the host's image viewer. A server path is local to the server;
   remote clients may need resource bytes. Text-only models can use coordinates
   and bounds but should not claim to have viewed an image.
4. Preview changes with `observe_project {file, revision, edits: [...]}`. This
   renders a visibly marked **DRAFT**, without writing or making a backup.
5. Commit the same sequence with `apply_edits {file, revision, edits: [...]}`.
   It validates all operations, locks the file, writes once and creates one backup.
   A failed sequence leaves the project unchanged. `dryRun: true` validates without
   rendering or writing. The proposed hash is separate from the current revision.
6. Observe the saved result and export. Use `start_export` / `get_export_job` for
   a long export; wait for success before using the output.

Read the live `vfx://guide` resource or use the `effect_workflow` prompt with
`{request, file}`. These describe the installed version's workflow to the host.
The revision is SHA-256 of actual disk bytes. Existing-project mutations require
it; read again after conflicts. `inspect_project` remains available for full
editable source, including embedded PNGs, when compact scene data is insufficient.

## Observe positions and motion

`observe_project` accepts `file`, optional `revision`, optional draft `edits`,
and the following inspection options. Discover exact limits/defaults with
`get_schema {kind: "observation"}`.

| Option                               | Behavior                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `view: "frame"`                      | One annotated frame; default view                                                               |
| `view: "storyboard"`                 | Up to six distributed visible sampled moments by default; `times` accepts 1..9 explicit seconds |
| `view: "layers"`                     | Isolated layer sheet at one time; top nine scoped layers, with omitted IDs reported             |
| `storyboardMode`                     | `active` (default) omits sampled blank tails; `timeline` preserves full-duration context        |
| `time`                               | Explicit seconds for frame/layers; omit to sample a visible representative moment               |
| `ids`                                | Scope rendering and metadata to 1..64 existing stable layer IDs                                 |
| `point: {x,y,threshold?}`            | Pick actual isolated alpha at a canvas point; hits ordered front to back                        |
| `crop: {x,y,width,height}`           | Annotated tile crop in original canvas pixels; clean PNGs keep full dimensions                  |
| `grid`, `guides`, `includeReference` | Defaults true; reference context never changes effect metrics or clean images                   |
| `background`                         | `checker` (default), `dark` or `transparent` for annotated tiles                                |
| `scale`                              | Requested annotation scale, fitted to image budgets                                             |
| `includeImage`                       | MCP-only; false omits the inline image while retaining metadata/resources                       |

Automatic selection measures alpha mass at at most 20 candidate times. It helps
avoid an empty opening/tail, but does not prove the entire animation is visible.
Explicit times are respected, including empty frames. `EMPTY_FRAME`, `EMPTY_CROP`,
`OUTSIDE_CANVAS` and `TOUCHES_EDGE` explain possible framing/timing problems.
Edge contact alone is not proof of clipping. Sampling considers the selected IDs.

- Canvas origin is top-left, +X right, +Y down, clockwise degrees, before export scaling.
- An anchor is separate from visible bounds. `layers[].pixels.bounds` measures
  rendered isolated alpha, including masks/modifiers, before occlusion. A masked
  hole does not pick. Multiple overlapping layers can hit, even when obscured.
- `geometryBounds` is unfiltered renderer geometry; `geometry.worldPoints` and
  path `localPoints` expose both coordinate spaces. `transform` includes animated
  anchor, rotation, scale and forward/inverse `[a,b,c,d,tx,ty]` matrices.
- Compare `baseTransform`, `resolvedTransform` and `drivenBy` before editing a
  macro-controlled property. A `set` binding can override a changed base value.
- Particle samples use world positions; particle opacity is evaluated by particle age.
- Layer states distinguish hidden, not-started, ended, outside-canvas and no visible pixels.
- Annotation bounds/IDs belong to the captioned **focus** time. Tile metadata
  records the mapping: `canvasX = crop.x + (imageX - viewport.x) / pixelsPerCanvasPixel`.
  Storyboards show bounds on that focus tile, rather than reusing them on other times.
- Times are project seconds; keyframe times remain normalized within their layer.

Clean PNG resources contain original-size straight RGBA, without guides or
references, and match the same export renderer. `images` records dimensions,
SHA-256, source revision and draft status. Resources are immutable snapshots,
retained up to **16 images / 24 MiB** per server session. Re-observe after expiry
or restart. `save_preview {uri, out: "inspection.png"}` refuses overwrite and
returns an absolute server path. Resource discovery includes cached images.

Annotated PNGs fit within 1,536 px per side, 1,048,576 pixels and 2 MiB. A large
MCP response can omit the inline image; `imageDelivery` explains this and resource
links remain available. Metadata is provided as text and structured content for
hosts supporting either. The host still determines whether images/resources are
exposed to its model; the server cannot make a nonvision model see them.

## Atomic authoring example

First observe and copy its revision. Replace `REVISION` below with that value.
Discover IDs from the scene; this example uses the Crimson cross template.

```json
{
  "file": "slash.vfx.json",
  "revision": "REVISION",
  "edits": [
    {
      "action": "set_path_points",
      "id": "cut-a",
      "space": "canvas",
      "time": 0.4,
      "points": [
        { "x": 22, "y": 104 },
        { "x": 64, "y": 64 },
        { "x": 106, "y": 22 }
      ]
    },
    { "action": "update_layer", "id": "sparks", "patch": { "count": 24 } },
    {
      "action": "creative",
      "operation": { "action": "set_control", "id": "intensity", "value": 0.8 }
    }
  ]
}
```

Send this object to `observe_project` to preview, then `apply_edits` to commit.
The observed revision stays the source revision until a successful commit.
Nested objects merge, arrays replace, and layer locks/composition budgets apply.
`set_path_points` accepts `local`, `canvas` or `normalized` coordinates and optional
Bezier handles. Normalized (0,0) is top-left and (1,1) the bottom-right canvas edge.
Handles are offset vectors in the chosen space. Conversion uses the resolved
animated transform at `time`. Replacing points without handles clears old handles.

`get_schema {kind: "edits"}` lists 1..64-operation batches: update_project,
add/update/remove_layer, reorder_layers, group_layers, transform_layers,
put_keyframe, set_path_points and creative operations. New batches use the existing
validated core functions. They do not execute arbitrary scripts.
Domain failures inside an operation include its index/number/action, error code
and recovery hint. Validation errors include issue paths where available. The
SDK can reject malformed tool inputs before these handlers run.

[Real MCP example, editable result and reproducible recipe](../examples/agent-workflow/README.md).

## Available tools

40 tools are available. Existing direct tools remain supported.

| Tool                                                       | Purpose                                                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| capabilities                                               | Installed version, root, coordinates, workflows and budgets                                          |
| list_presets / get_preset                                  | Editable example discovery                                                                           |
| get_schema                                                 | Project/layer/asset/pixels/export/creative/modifier/control/edits/observation/analysis/batch schemas |
| new_project / inspect_project                              | Create or read full source                                                                           |
| set_gradient                                               | Exact solid color or gradient for all/selected layer source colors                                   |
| preflight_export                                           | Numeric resource usage/limits without a browser                                                      |
| analyze_project                                            | RGBA hashes, reverse-order parity and saved baseline regression checks                               |
| batch_projects                                             | Independent create/edit/export tasks and project-count jobs                                          |
| observe_project                                            | Annotated images, scene coordinates, layer states, bounds and draft inspection                       |
| apply_edits                                                | Revision-checked atomic sequence or validation-only dry run                                          |
| save_preview                                               | Cached PNG to a fresh file for host image viewers                                                    |
| update_project                                             | Merge project fields or replace arrays                                                               |
| add_layer / update_layer / remove_layer                    | Direct layer authoring                                                                               |
| reorder_layers / group_layers / transform_layers           | Layer order and selection editing                                                                    |
| put_keyframe                                               | Insert/replace a normalized key                                                                      |
| list_backups / restore_backup                              | Disk versions and revision-checked restoration                                                       |
| import_asset / optimize_asset / optimize_png               | Embedded textures and PNG processing                                                                 |
| resize_project / recolor_project                           | Canvas size and selected/all gradient color                                                          |
| render_preview                                             | Clean inline PNG, pixel bounds and resource fallback                                                 |
| inspect_creative / edit_creative                           | Discover/edit controls, modifiers, looks and timing                                                  |
| save_component / insert_component                          | Portable editable parts                                                                              |
| export / start_export / get_export_job / cancel_export_job | Synchronous or managed exports                                                                       |
| start_variant_export                                       | Managed export of saved variants                                                                     |

Jobs pin an immutable project snapshot when submitted, after checking revision.
They use one worker, hold at most 16 states, and evict completed states first.
Queued/running jobs can be cancelled; poll until `cancelled`, `succeeded` or
`failed`. Completed outputs persist; job state does not survive server restart.
Cancellation before completion closes headless Chromium and removes partial
publication. Cancellation after successful publication may return success.

Project mutations lock `FILE.lock`, validate the entire result, then replace the
project atomically. A crashed edit can leave a lock; first confirm no tool is
editing before removing that sidecar. Browser undo/redo is session-local;
CLI/MCP edits use revisions; editor undo is session-local.

Exports are fully rendered in memory before reserving a fresh output directory.
During publication a `.vfx-exporting` marker exists; metadata is written last
and the marker removed on completion. The output directory is not atomically
revealed as a unit. Existing destinations refuse overwrite. Input/output parents
must exist and resolve within root; symlinks that escape root are rejected.

The official SDK caps its input buffer at 4 MiB and input element count at 50,000.
Stdout is protocol-only; errors return tool errors. JavaScript execution is not
an MCP tool. External Codex/Claude GUI sessions must be configured by the user;
the SDK protocol client is tested automatically.

`optimize_png` takes `{png, out, options}`; defaults preserve decoded RGBA.
`options` can set `scale`, `colors`, `dither`, `pixelSize` and `alphaLevels`.
It writes a new file and returns `{file, stats, sha256}` without Chromium.
`optimize_asset` adds `file`, `revision` and asset `id`; it rejects a changed
sheet size if its existing grid no longer divides the image. `resize_project`
takes `width`, `height`, and `mode: "scale" | "canvas"`. `recolor_project` takes
`hue` in degrees, optional `ids`, and `includeLocked` (default false).

Export options inherit project `output` unless overridden. `scale` supports
0.125..8 in all formats, `padding` supports 0..16, and `extrude` fills padding
with edge pixels. Progress counts encoded frames; zero indicates preparation.
Wait for terminal success before consuming the output folder.

`group_layers` takes `{file, revision, id, name, ids}`; each layer belongs to at
most one flat group. Grouping does not alter layer order. `transform_layers`
takes `ids`, optional `x`, `y`, `rotation`, `scale`, `pivot: {x,y}` and
`includeLocked`. Its default pivot is the mean of selected unlocked anchors.
It transforms position and world X/Y motion together. Differently timed/eased
nonlinear X/Y curves must be aligned before rotation, so motion is preserved.

`put_keyframe` takes `{file, revision, id, channel, time, value, ease}`. Time is
normalized **within the layer**, from 0 to 1, not project seconds. Supported
channels include `opacity`, `motion.x`, `motion.y`, `motion.rotation`,
`motion.scale` and the layer's geometry/draw curves. Get the schema for limits.

`list_backups` takes `{file}` and returns `{result: [{id, updated, bytes}]}`.
`restore_backup` takes `{file, revision, id}` from that list. Every valid edit
backs up the replaced bytes in `.vfx-backups`; five distinct versions per file
are retained. Restoration backs up the current file too.

`update_layer` can set `handles` on a path (one `{in:{x,y},out:{x,y}}` per anchor,
offsets in local coordinates) or `mask` (rectangle, ellipse or polygon).
`update_project` can set `editor.reference` and `editor.range`. The reference is
saved in the project but excluded from rendered pixels and exported source. A
work range controls Studio playback. Export remains full-duration unless its
`options.start/end` explicitly select an interval.

## Creative operations

`inspect_creative {file}` returns the revision, controls, variants, modifier order
and an explicit binding-target registry for every layer. `edit_creative` takes
`{file, revision, operation}`; discover its discriminated operation schema with
`get_schema {kind: "creative"}`. Operations cover modifier/control CRUD, setting
control values, capturing/applying/removing variants, whole-effect retiming and
selection staggering. A curve binding transforms every key's value; it does not
change key times. Numeric count/segment/octave targets round to integers.

```json
{
  "action": "put_control",
  "control": {
    "id": "energy",
    "name": "Energy",
    "min": 0.25,
    "max": 2,
    "value": 1,
    "bindings": [
      { "layer": "sparks", "target": "size", "mode": "multiply" },
      { "layer": "shockwave", "target": "width", "mode": "multiply" }
    ]
  }
}
```

Bindings use `value * factor + offset`, then set/add/multiply the original field.
Multiple controls apply in stored order. `colors.hue` always rotates the gradient
by that number of degrees. Unknown targets and invalid computed results fail
before writing. Removing a layer/modifier prunes its bindings. Removing a control
also removes its entries from saved looks.

`save_component {file, revision, ids, name, out}` writes a fresh portable component.
`insert_component {file, revision, source, x?, y?}` returns the new project and
inserted IDs. Assets and all internal layer/group/control references are remapped;
identical PNG/grid assets are reused. Copies are independent, not external links.

`start_variant_export {file, revision, ids, out, options}` uses the existing job
poll/cancel tools. It renders 1–8 saved looks in one browser session. Output folders
are named by variant IDs. Each includes normal export metadata/project/checksums.
`variants.vfx.json` retains the base effect and all looks. Bounds: 32 million source
pixels and 64 MiB generated output per batch. `options.start/end` optionally trim
any export while keeping the source project intact.

## Direct gradients, numeric QA and independent project batches

`set_gradient {file, revision, colors: "#804cff"}` sets a solid source color.
`colors` may instead be a complete array of `{t,color}` stops. Optional `ids` and
`includeLocked` follow existing selection behavior. This colors gray smoke where
hue rotation cannot. Fully selected hue-only controls reset to zero; mixed controls
lose only affected hue bindings, so locked/unselected colors do not change. Texture
pixels and modifier colors remain independent. `apply_edits` accepts the same
`action: "set_gradient"`, including draft previews. Studio exposes it in Recolor.

`preflight_export {file, options}` returns `ok`, `checks: [{resource,used,limit,passed}]`,
its computed plan and RGBA-buffer memory estimates. It starts no browser and
writes no files. It shares the export validator. Budget failures from actual
exports carry `LIMIT_EXCEEDED` and the same numeric report. Estimates exclude
encoder, browser and GPU overhead.

`analyze_project {file, out: "baseline.json"}` produces SHA-256 of **straight RGBA**,
alpha/bounds/activity statistics per frame, plus parity against reverse-order
rerenders. Defaults to all original export frame times, bounded by 300 frames /
16,777,216 source pixels. Optional `times` selects explicit samples and
`parity:false` skips that rerender check. No image-encoding bytes are hashed.
`analyze_project {file, baseline: "baseline.json"}` uses that baseline's times unless
explicit times are supplied, compares dimensions and hashes, and reports missing
times/mismatches. Inspect `ok`; a comparison failure is a valid QA result, not a
protocol error. A baseline may cover a subset of times. Reports save only to fresh
root-scoped JSON paths. CLI `vfx analyze` exits 2 on failed QA. Equal hashes prove
repeatability/equality on the tested renderer, not that an effect looks right or
that its activity peak is the correct game hit frame. Empty frames remain in stats.

`batch_projects` takes `items`, a discriminated array of up to 32 tasks:

```json
{
  "items": [
    {
      "action": "create",
      "file": "purple-smoke.json",
      "preset": "smoke",
      "edits": [{ "action": "set_gradient", "colors": "#804cff" }],
      "out": "purple-smoke-gif",
      "options": { "format": "gif" }
    },
    { "action": "create", "file": "rain.json", "preset": "rain" }
  ],
  "dryRun": true
}
```

Create takes `preset` or `project`, optional `seed/edits`, and optional `out/options`.
Edit takes `file/revision/edits`, plus optional `out/options`. Export takes
`file/revision/out/options`. Options require an output directory. Dry runs check
files, revisions, schemas and export budgets without writing or rendering. Real
runs return a job; poll existing `get_export_job`. Its `progressUnit` is `projects`.
Snapshots are pinned at submission, with a 16-MiB combined source cap. Each input
and output path must be distinct; use another batch after creation to export
the same projects in a second format. Parent directories must exist.

Atomicity is **per edited file**, not across projects or a project-plus-export.
Each edited file gets one revision check and backup. Failed items do not undo
successful files. `partial` means the project was written but its export failed.
Cancellation preserves completed writes and marks pending items cancelled. A batch
job with failed items finishes `failed` and retains `result.results`; always inspect
`result.ok` and item statuses. Domain failures are recorded per item. Malformed
request schemas, duplicate paths or the aggregate snapshot cap can reject the
whole request before any job/write. Nothing overwrites an existing export folder.

CLI equivalents: `vfx gradient`, `vfx preflight`, `vfx analyze`, and
`vfx batch --tasks-file tasks.json [--dry-run]`. They share the same operations.
The CLI batch command exits 2 on failed/partial items (130 on cancellation).

## Warm rendering and storyboard timing

A long-lived MCP server lazily keeps up to two isolated workers warm, with a
30-second idle timeout. Project resources are reused for identical input. A
cancelled in-flight render discards its own worker without closing another one.
CLI commands close their pool on exit; separate CLI invocations still start cold.
Use CLI batch to reuse the renderer across its tasks. `capabilities.renderer`
reports launches, requests, reuse and active/idle counts.

Default storyboards select distributed visible **sampled** moments and retain
actual timestamp captions. This compresses empty pauses; it does not trim exports
or prove unsampled moments are empty. Request `storyboardMode:"timeline"` for
full-duration context, or explicit `times` to preserve a chosen blank interval.
`sampling.emptySamplesOmitted` records omitted sampled empty times.

## 0.7.4 Blueprint discovery and shared edits

`get_blueprint {file}` is a read-only compact graph query. It returns the observed
revision, numeric controls and order, layer IDs/names/lock state, typed valid input
ports, current connections with ready-to-use `disconnectEdit`, modifiers and image
pipeline order. It does not decode assets or start a browser. It is the same
project graph exposed in Studio's Blueprint workspace.

`apply_edits` adds `connect_control`, `disconnect_control` and `edit_path_point`.
These work with dryRun, draft observation and multi-project batch edits. Connections
validate the resulting effect rather than accepting out-of-range parameters.
One batch produces one revision and backup; failure commits none of the edits.
Connection indices belong to the revision that supplied them. Existing controls,
modifiers, base layers and curves remain editable through their existing operations.

See [Blueprint with a real JSON example](BLUEPRINT.md), the live `vfx://guide`
resource and the `effect_workflow` prompt. AI-native here means external agents can
discover, author, observe and verify without mouse automation. A host that omits
images can read/save the image resources; do not claim visual judgment from text alone.

## Separate camera stage

Ordinary 2D tools and coordinates remain the default. `get_stage {file}` returns
the current revision, optional camera scene, placement IDs and world conventions.
Use `get_schema {kind:"stage"}` / `stage_placement`, then shared edit batches with
`configure_stage` and `place_stage_layer`. `render_preview` accepts `view:"stage"`
and optional revision/edits for a source-preserving draft.
`analyze_project {view:"stage"}` checks projected raw RGBA; it will not accept a
2D baseline as a matching Stage baseline. Export jobs/batches accept
`options:{view:"stage"}`. See [Stage examples and limitations](STAGE.md).

## Add catalog

`get_node_catalog {file,layer?}` reads the same catalog as Studio Add. Each available
entry includes a validated example `edit`; unavailable entries explain why.
Preview/commit it using the returned revision. IDs are chosen to avoid current
project IDs. You can customize its generated layer/control values before the normal
atomic validation. Catalog lookup does not open a browser or write files.
