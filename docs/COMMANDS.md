# Command reference

`vfx [--root DIR] [--json] COMMAND`. Global flags also work after subcommands.
`--root` defaults to the working directory. Normal output is pretty JSON;
`--json` emits one compact line. Success: `{"ok":true,"data":...}`. Domain errors:
`{"ok":false,"error":{"code":"...","message":"..."}}`, nonzero exit status.
Help/version output is text. With `--json`, argument errors use the envelope too.

| Command | Behavior |
| --- | --- |
| `doctor` | Backend, interfaces, formats, platform and limits |
| `preset list` | Embedded recipe IDs, descriptions, canvases, durations and typed parameters/defaults |
| `preset show ID [--out FILE]` | Inspect complete recipe, or save a bare customizable copy without overwrite |
| `node list` | Actual node types, port type, units and node schema |
| `schema project\|patch\|node\|recipe\|asset\|post_process\|export` | Full JSON Schema |
| `new FILE [--preset ID \| --preset-file FILE] [--params JSON] [--name NAME] [--canvas WxH] [--seed N] [--smooth] [--duration SECONDS]` | Validate and create a project; defaults: library default preset/canvas (spark_burst, 64×64), seed 42, pixel mode |
| `asset list FILE` | Embedded asset IDs, sizes, grids, frame counts and pixel hashes |
| `asset import FILE --file PNG --id ID --expected-revision N [--columns N] [--rows N] [--frames N] [--dry-run]` | Embed/update a PNG or sheet; grid defaults 1×1, frames defaults grid cells |
| `material FILE --emitter ID --settings JSON --expected-revision N [--dry-run]` | Insert/update a material node automatically |
| `timeline FILE --emitter ID --settings JSON --expected-revision N [--dry-run]` | Insert/update a timeline node automatically |
| `recipe save FILE --out NEWFILE --id ID --description TEXT` | Save scene/assets/post-processing as a new portable recipe; parameter declarations initially empty |
| `analyze FILE [--samples N] [--compare-fresh]` | Measure 2–32 samples (default 12), clipping, blank samples, cache work and optional fresh-render pixel parity |
| `inspect FILE` | Scene, revision, versions and history depths |
| `validate FILE` | Validate version, graph, values and limits |
| `patch FILE --expected-revision N (--ops JSON \| --ops-file FILE) [--dry-run]` | Atomic typed operation array |
| `undo FILE --expected-revision N` | Restore prior scene; revision advances |
| `redo FILE --expected-revision N` | Restore future scene; revision advances |
| `preview FILE --out FILE [--times T,...]` | Transparent PNG montage at 1–8 times; default 0.05,0.15,0.3,0.5 |
| `export FILE --out NEWDIR [--format sequence\|spritesheet\|gif\|godot\|unity] [--fps N] [--progress]` | Images + metadata; default spritesheet, 20 FPS |

`--progress` emits compact JSON events to stderr; stdout remains the normal result
envelope. Material/timeline settings replace the entire settings object, using
defaults for omitted fields. Inspect existing settings before updating only one
aspect. PNG asset imports and node configuration are atomic, undoable mutations.

Times use seconds in `[0, duration_seconds)`. Montages have up to four columns
and retain requested sample order. A duration override changes the scene window;
it does not rescale emission schedules/lifetimes. All input/output paths must
resolve within root; output parents must exist. Creations reject existing
outputs. Exports publish a complete staged directory, or leave no output folder.
Edits save immediately; `.lock` files hold no project data.

GIF-only flags (rejected with PNG formats):

| Flag | Meaning / default |
| --- | --- |
| `--scale N` | Integer nearest-neighbor scaling, 1–8 / 1 |
| `--background '#RRGGBB'` | Opaque RGB matte, linear-light composite / black |
| `--no-loop` | Omit infinite-repeat extension / repeat enabled |
| `--quantizer-speed N` | 1–30, 1 is highest palette quality / 10 |

GIF has centisecond timing and at most 256 palette colors per frame. Metadata
records actual encoded duration; frame pixel hashes describe native RGBA before
matte/scaling/quantization. Use PNG for transparent game assets. GIF output is
`animation.gif`; sequence is `frame_0000.png` etc; spritesheet is `atlas.png`.
Each has `metadata.json` with timing, rects, source settings, stats and hashes.

Exit codes: 0 success; 2 invalid input; 3 I/O/busy/existing target; 4 stale revision;
5 root boundary; 6 resource limit. Domain failures do not terminate MCP sessions.

## Patch operations

`set_name`, `set_canvas`, `set_simulation`, `add_node`, `replace_node`,
`remove_node`, `connect`, `disconnect`, `set_output`, `upsert_asset`,
`remove_asset`, `set_post_process`. A referenced asset cannot be removed while
its sprite/mask references remain; remove those references in the same batch.
 Discover complete arguments
with `vfx schema patch`. A batch can rewire several nodes while only its final
candidate must be valid. Removing a node also removes incident edges. Empty,
unknown-field, no-change and stale-revision patches fail without rewriting.

```bash
vfx patch impact.vfxproj --expected-revision 0 --ops '[
  {"op":"replace_node","node":{"id":"color","kind":{
    "type":"color_over_life","start":[100,220,255,255],"end":[40,40,230,0]
  }}}
]'
```

This node ID exists in `spark_burst`; inspect other recipes before editing.
`set_simulation` takes the full object, e.g.
`{"seed":42,"tick_hz":60,"duration_seconds":0.8}`. Export FPS does not alter it.
`set_canvas` edits the canvas only; recipe instantiation performs automatic
scaling, while this low-level patch leaves node coordinates explicit.

## MCP mapping

Exactly 22 tools, using the same command API:

| Tool | Arguments / operation |
| --- | --- |
| `vfx_get_capabilities` | No arguments; actual capabilities |
| `vfx_list_presets` | No arguments; catalog and parameter declarations |
| `vfx_get_preset` | `id`; full data recipe/defaults |
| `vfx_list_node_types` | No arguments; node types/units/schema |
| `vfx_get_schema` | `kind`: project, patch, node, recipe, asset, post_process or export |
| `vfx_new_project` | `path`; optional preset, preset_file, params, name, width, height, seed, pixel_mode, duration_seconds |
| `vfx_inspect_project` | `project` |
| `vfx_validate` | `project` |
| `vfx_apply_patch` | project, expected_revision, operations, optional dry_run |
| `vfx_undo`, `vfx_redo` | project, expected_revision |
| `vfx_render_preview` | project, times; inline PNG + statistics, no disk output |
| `vfx_import_asset` | project, file, id, expected_revision; optional columns/rows/frames/dry_run |
| `vfx_list_assets` | project; dimensions, frames and hashes |
| `vfx_set_material` | project, emitter, settings, expected_revision, optional dry_run |
| `vfx_set_timeline` | project, emitter, settings, expected_revision, optional dry_run |
| `vfx_save_recipe` | project, out, id, description; new file only |
| `vfx_analyze` | project, samples (default 12), compare_fresh (default false) |
| `vfx_start_export` | export: full export request; expected_revision: required source revision |
| `vfx_get_export_job` | job_id; state/progress/result/error |
| `vfx_cancel_export_job` | job_id; request cooperative cancellation |
| `vfx_export` | project, out, format, fps; optional gif settings |

MCP uses the success/error envelope in `structuredContent`, with `isError:true`
for domain errors. Malformed tool arguments are protocol errors. There is no
shell execution, code evaluation, HTTP listener or network dependency. Stdout is
reserved for JSON-RPC; startup failures use stderr.

## Background export semantics

`vfx_start_export` returns immediately with a session-scoped job ID. Example:

```json
{
  "export":{"project":"portal.vfxproj","out":"portal-assets","format":"godot","fps":25},
  "expected_revision":0
}
```

Poll `vfx_get_export_job` with `{"job_id":"job-0000000000000000"}` using the
actual returned ID. States are queued, running, cancelling, succeeded, failed
and cancelled. On success, `result` is the regular export result. A source
revision change before execution fails with REVISION_CONFLICT; once read, the
worker renders an immutable snapshot. Two workers are shared with synchronous
render commands; at most 32 jobs are retained, with completed jobs evicted first.

Cancellation is cooperative, including during particle integration and image
operations. Wait for cancelled state before assuming cleanup. A request past
its atomic publication point can finish successfully. Job IDs/state do not
persist across server restarts; completed asset folders do. Stdout never carries
progress logs outside JSON-RPC. The CLI remains synchronous and exposes stderr
progress; use MCP for job control.
