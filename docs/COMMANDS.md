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
| `schema project\|patch\|node\|recipe` | Full JSON Schema |
| `new FILE [--preset ID \| --preset-file FILE] [--params JSON] [--name NAME] [--canvas WxH] [--seed N] [--smooth] [--duration SECONDS]` | Validate and create a project; defaults: library default preset/canvas (spark_burst, 64×64), seed 42, pixel mode |
| `inspect FILE` | Scene, revision, versions and history depths |
| `validate FILE` | Validate version, graph, values and limits |
| `patch FILE --expected-revision N (--ops JSON \| --ops-file FILE) [--dry-run]` | Atomic typed operation array |
| `undo FILE --expected-revision N` | Restore prior scene; revision advances |
| `redo FILE --expected-revision N` | Restore future scene; revision advances |
| `preview FILE --out FILE [--times T,...]` | Transparent PNG montage at 1–8 times; default 0.05,0.15,0.3,0.5 |
| `export FILE --out NEWDIR [--format sequence\|spritesheet\|gif] [--fps N]` | Images + metadata; default spritesheet, 20 FPS |

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
`remove_node`, `connect`, `disconnect`, `set_output`. Discover complete arguments
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

Exactly 13 tools, using the same command API:

| Tool | Arguments / operation |
| --- | --- |
| `vfx_get_capabilities` | No arguments; actual capabilities |
| `vfx_list_presets` | No arguments; catalog and parameter declarations |
| `vfx_get_preset` | `id`; full data recipe/defaults |
| `vfx_list_node_types` | No arguments; node types/units/schema |
| `vfx_get_schema` | `kind`: project, patch, node or recipe |
| `vfx_new_project` | `path`; optional preset, preset_file, params, name, width, height, seed, pixel_mode, duration_seconds |
| `vfx_inspect_project` | `project` |
| `vfx_validate` | `project` |
| `vfx_apply_patch` | project, expected_revision, operations, optional dry_run |
| `vfx_undo`, `vfx_redo` | project, expected_revision |
| `vfx_render_preview` | project, times; inline PNG + statistics, no disk output |
| `vfx_export` | project, out, format, fps; optional gif settings |

MCP uses the success/error envelope in `structuredContent`, with `isError:true`
for domain errors. Malformed tool arguments are protocol errors. There is no
shell execution, code evaluation, HTTP listener or network dependency. Stdout is
reserved for JSON-RPC; startup failures use stderr.
