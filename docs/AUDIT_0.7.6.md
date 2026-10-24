# Browser and agent workflow audit · 0.7.6

The review starts from an installed 0.7.5 package, then repeats failed workflows
against the corrections. It uses the browser's actual controls/files/downloads
and the official MCP SDK over stdio. It does not substitute button presence or
code inspection for completing the workflow. Source tests also exercise the
existing drawing, file, animation and export surfaces.

| Workflow             | Evidence and outcome                                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2D authoring         | Add, transforms, selection, saved parts, recolor, retime, resize, optimizer, reference, save/download/reload and export. Separate 2D defaults were found and unified with the catalog.          |
| Detailed authoring   | Blueprint Add/search, number/modifier editing, parameter connections, fit/layout/undo. Existing regression suite retains actual port drags and path/curve editing.                              |
| Stage                | Placement/rotation/stretch, scene framing, camera alignment, exact preview, export and reload. Component insertion lost Stage data; now retained under remapped IDs.                            |
| Small windows        | A 1024×600 window with large text and open panels shrank the canvas severely. Adaptive drawers/folded transport keep it usable without discarding desktop preferences.                          |
| Assets               | A valid MCP import failed because request metadata entered the strict asset schema. Static/wide PNG and flipbook imports now complete through preview and export.                               |
| Reuse                | Repeated insertions had ambiguous duplicate names and left Saved after each insertion. Names are allocated independently and Saved stays available on desktop.                                  |
| Composition resizing | Spatial control overrides and camera/world coordinates were not resized with base layers. Resolved set/add/multiply invariants now hold across resizing and subsequent control changes.         |
| Agent discovery      | All 41 tools called successfully; all 14 schemas, workflow prompt/guide and image-resource fallback read. Documentation tool count corrected.                                                   |
| Agent output         | Actual storyboard, clean/layer PNGs, numeric parity/baselines, sequence/GIF, Godot variant batch, Unity/spritesheet multi-project batch and cancelled background job.                           |
| Recovery and faults  | Revision conflict and invalid atomic edit preserve source bytes; root escape rejected. Backup/restore, recovery and disk save conflicts are also covered by the existing browser/server suites. |

A valid 2.56 MiB embedded-image project also returned its four assets through the
SDK, checking that a larger response works in the tested transport. This is not
a guarantee about another host's context limits. Prefer compact observations and
catalog/graph discovery when full embedded source is unnecessary.

[Short-window screenshot and measurements](../examples/usability/README.md) and
[an editable GUI-built effect with GIF](../examples/workspaces/README.md) are
checked in for review.

The patch adds no dependency, copied implementation or new VFX simulation mode.
Stage remains camera placement of animated planes; Blueprint uses the existing
ordered image pipeline. See [validation](VALIDATION_0.7.6.md) for test scope and
platforms not exercised.
