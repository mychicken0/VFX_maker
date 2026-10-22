# MCP workflow

The stdio server is `vfx-mcp --root /absolute/path/to/effects`. The host launches
it; no persistent HTTP service is needed. Chrome/Chromium must be discoverable
for rendering. File editing and schemas do not require a running browser.

1. Call `list_presets`, then `get_preset` or `get_schema` to discover data.
2. `new_project` creates a portable project from a preset or a supplied project.
3. `inspect_project` returns `{project, revision}`. The revision is the SHA-256
   of the actual disk bytes, not a counter. Every mutation requires it.
4. `update_layer` takes `file`, `revision`, `id` and `patch`. For example,
   `{"count":90,"gravity":{"y":0},"colors":[{"t":0,"color":"#ff2244"}]}`.
   Nested objects merge. Arrays, including curves/points, replace the old array.
5. `render_preview` returns an inline PNG image and source revision.
6. `export`, or `start_export` + `get_export_job`, writes a new output folder.

| Tool                                              | Purpose                                            |
| ------------------------------------------------- | -------------------------------------------------- |
| capabilities                                      | Version, root, formats and budgets                 |
| list_presets / get_preset                         | Editable example discovery                         |
| get_schema                                        | Project/layer/asset schema and defaults            |
| new_project / inspect_project                     | Create or read a project                           |
| update_project                                    | Merge project fields or replace layer/asset arrays |
| add_layer / update_layer / remove_layer           | Direct layer authoring                             |
| reorder_layers                                    | Supply all IDs in bottom-to-top order              |
| import_asset                                      | Embed a root-scoped static PNG / sheet             |
| render_preview                                    | Actual PixiJS image, no file creation              |
| export                                            | Synchronous export with expected revision          |
| start_export / get_export_job / cancel_export_job | Managed exports                                    |

Jobs pin an immutable project snapshot when submitted, after checking revision.
They use one worker, hold at most 16 states, and evict completed states first.
Queued/running jobs can be cancelled; poll until `cancelled`, `succeeded` or
`failed`. Completed outputs persist; job state does not survive server restart.
Cancellation before completion closes headless Chromium and removes partial
publication. Cancellation after successful publication may return success.

Project mutations lock `FILE.lock`, validate the entire result, then replace the
project atomically. A crashed edit can leave a lock; first confirm no tool is
editing before removing that sidecar. Browser undo/redo is session-local;
CLI/MCP do not have the Rust version's persistent disk history.

Exports are fully rendered in memory before reserving a fresh output directory.
During publication a `.vfx-exporting` marker exists; metadata is written last
and the marker removed on completion. The output directory is not atomically
revealed as a unit. Existing destinations refuse overwrite. Input/output parents
must exist and resolve within root; symlinks that escape root are rejected.

The official SDK caps its input buffer at 4 MiB and input element count at 50,000.
Stdout is protocol-only; errors return tool errors. JavaScript execution is not
an MCP tool. External Codex/Claude GUI sessions must be configured by the user;
the SDK protocol client is tested automatically.
