# MCP workflow

The stdio server is `vfx-mcp --root /absolute/path/to/effects`. The host launches
it; no persistent HTTP service is needed. Chrome/Chromium must be discoverable
for rendering. File editing and schemas do not require a running browser.

1. Call `list_presets`, then `get_preset` or `get_schema` to discover data.
2. `new_project` creates a portable project from a preset or a supplied project.
3. `inspect_project` returns `{project, revision}`. The revision is the SHA-256
   of the actual disk bytes, not a counter. Every edit of an existing project requires it.
4. `update_layer` takes `file`, `revision`, `id` and `patch`. For example,
   `{"count":90,"gravity":{"y":0},"colors":[{"t":0,"color":"#ff2244"}]}`.
   Nested objects merge. Arrays, including curves/points, replace the old array.
5. `render_preview` returns an inline PNG image and source revision.
6. `export`, or `start_export` + `get_export_job`, writes a new output folder.

| Tool                                              | Purpose                                                 |
| ------------------------------------------------- | ------------------------------------------------------- |
| capabilities                                      | Version, root, formats and budgets                      |
| list_presets / get_preset                         | Editable example discovery                              |
| get_schema                                        | Project/layer/asset schema and defaults                 |
| new_project / inspect_project                     | Create or read a project                                |
| update_project                                    | Merge project fields or replace layer/asset arrays      |
| add_layer / update_layer / remove_layer           | Direct layer authoring                                  |
| reorder_layers                                    | Supply all IDs in bottom-to-top order                   |
| group_layers                                      | Named selection groups; preserves compositing order     |
| transform_layers                                  | Translate, rotate and uniformly scale selected layers   |
| put_keyframe                                      | Insert/replace a normalized curve key                   |
| list_backups / restore_backup                     | Retained disk versions and revision-checked restoration |
| import_asset                                      | Embed a root-scoped static PNG / sheet                  |
| optimize_png                                      | PNG to a fresh file, with byte/pixel stats and hash     |
| optimize_asset                                    | Revision-checked PNG replacement; keeps grid            |
| resize_project                                    | Uniform composition resize or canvas bounds             |
| recolor_project                                   | All/selected gradient and tint hue rotation             |
| render_preview                                    | Actual PixiJS image, no file creation                   |
| export                                            | Synchronous export with expected revision               |
| start_export / get_export_job / cancel_export_job | Managed exports                                         |

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

26 tools are available. `get_schema` also accepts `pixels` and `export`.
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
work range affects Studio playback only; exports use the full project duration.
