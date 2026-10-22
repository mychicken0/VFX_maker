# 0.5.0 validation

Verified 2026-10-22 on Linux, Node 24.19.0 and Chromium 154.0.8037.57 with
SwiftShader. These results describe this environment; they do not establish
identical rasterization across different GPU/browser versions.

| Check                    | Result                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| TypeScript               | `npm run typecheck` passed                                                                           |
| Unit/storage/pixel tests | 30 passed                                                                                            |
| Chromium end-to-end      | 22 passed                                                                                            |
| Source production build  | Passed                                                                                               |
| Development server       | Editor boot and PNG worker succeeded without page errors                                             |
| npm dependency audit     | Zero known advisories, including development dependencies after the test-runner patch update         |
| Runtime notices          | 119 installed packages; every entry has license/notice text                                          |
| PNG benchmarks           | 18 actual Pixi-rendered source PNGs; independent decoder verified exact lossless RGBA                |
| Godot resource           | Godot 4.5.1 loaded 3 scaled frames, 0.21s total, exact regions/FPS/last-frame timing                 |
| Installed CLI/MCP        | Package tools tested from an unrelated Thai path containing spaces using the official MCP SDK client |

The automated checks exercise all 18 preset renders, scrub reproducibility,
layer ordering, partial alpha, flipbooks/glow/keyframes, all five export formats,
frame metadata and SHA-256, shared palette and alpha limits, nearest scaling,
atlas edge extrusion, portable projects, revision conflicts, queued/running
job cancellation, CLI TypeScript authoring, and the four new project/image tools.
Browser interaction checks include point/clip dragging, pointer cancellation,
modal focus/shortcuts, undo/redo/autosave, recent project recovery, canvas resize,
hue recoloring and stale optimizer work. Invalid image headers are rejected
before a source image element is created.

## Window measurements

| Window                                            | Page dimensions | Export reachable |
| ------------------------------------------------- | --------------- | ---------------- |
| 1440 × 1000                                       | 1440 × 1000     | Yes              |
| 1024 × 640                                        | 1024 × 640      | Yes              |
| 768 × 640                                         | 768 × 640       | Yes              |
| 390 × 700                                         | 390 × 700       | Yes              |
| 640 × 360                                         | 640 × 360       | Yes              |
| 320 × 700 (additional manual browser measurement) | 320 × 700       | Yes              |

The previous small-window build forced a 1000px-wide page at 768/390px.
Current tests also open a 512 × 512 canvas and check that Fit keeps it inside
the preview. Narrow windows use side drawers. Viewport tests cover the layout
sizes encountered when browser zoom reduces the available CSS width; separate
desktop browser zoom controls were not automated.

## PNG measurements

`node scripts/benchmark-pixels.mjs --gallery GALLERY --out NEW_DIRECTORY`
processes one actual rendered frame from every template. Aggregate byte counts:

| Mode                                     | Input bytes | Output bytes | Reduction |
| ---------------------------------------- | ----------: | -----------: | --------: |
| Default lossless                         |      136745 |        80993 |     40.8% |
| 0.5 scale, 16 RGB colors, 4 alpha levels |      136745 |        11576 |     91.5% |

The second mode changes image detail and transparency. These are measurements
of these 18 frames, not guaranteed compression ratios for arbitrary images.
Each sample includes source/output hashes, exact dimensions/color counts, byte
counts, settings and elapsed time in `measurements.json`. Default lossless mode
keeps the original encoding when it would be smaller. The illustrated sword
frame at 0.40s decreases from 12.9 to 10.2 KiB (20.8%) without changing RGBA.

Screenshots: [Studio](../examples/studio.png),
[pixel optimizer](../examples/pixel-optimizer.png),
[recolor preview](../examples/recolor.png).

## Practical boundaries

PixelLab Create VFX redirected to sign-in. Public page/source observations are
recorded in the research document; account-only generation and authenticated
editing were not exercised. External Codex/Claude GUI host configuration,
Unity Editor, macOS/Windows and hosted CI execution were not tested here.
Godot's resource import was tested in the actual engine.

Export cancellation is cooperative between processing steps in Studio. A single
synchronous PNG encode completes before the next UI cancellation event; CLI/MCP
can close the headless browser. Project byte/pixel budgets limit allocations.
Browser backups depend on browser storage; downloading the project creates a
portable copy. A saved cloud setup draft still needs Save/Publish to activate
the retained environment snapshot.
