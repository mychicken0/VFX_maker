# 0.7.3 validation

Executed on 2026-10-23 using Node 24.19.0 and Linux Chromium/SwiftShader.

- **73 unit tests:** existing behavior plus exact gradients on neutral colors,
  selected/locked/mixed hue bindings, 64-layer groups/components, translated
  128-binding components, independent keyframe caps, shared numeric budgets,
  16-project dry runs/edits/backups, stale revisions, duplicate aliases, partial
  export failure and cancellation retaining completed writes.
- **65 browser/CLI/MCP scenarios:** includes seven new project-workflow scenarios,
  the existing 0.7.2 agent cases, 64-layer narrow Studio editing with undo,
  direct gradients, actual multi-project GIF/sequence/Godot-compatible output,
  parity/baseline mismatch detection, failed QA exit codes, preflight without
  Chromium startup and concurrent-worker cancellation isolation. Existing shader,
  exact-pixel export, narrow layout, native Save/Save As, recovery, keyboard,
  reference/mask, component, timing and optimizer checks remain covered.
- **32 scenarios repeated against the installed tarball** from outside the checkout:
  project workflows, previous agent/CLI/MCP workflows, Studio and library layouts.
- Formatting, TypeScript and production build pass. All 22 templates are rendered
  as GIFs and atlases; the nine README GIFs remain actual renders of their editable
  projects. Source/installed builds are compared byte-for-byte.

## Actual multi-project MCP run

`scripts/verify-project-workflows.mjs` launches an official SDK stdio client. It
creates 16 projects from blue_magic, smoke, dust, rain, heal_pulse, stardust,
masked_portal and pixel_flame with two color/size variations. It dry-runs, commits
and exports GIFs in one batch, then exports the returned revisions to Godot in
another batch. Every project passes reverse-order raw-RGBA parity at four explicit
times. A saved baseline comparison passes too. This session makes **51 render
requests using one browser launch**. Actual smoke/rain storyboard images were
opened and inspected.

[Recipe, two GIFs, editable projects, QA reports and complete run manifest](../examples/workflows-0.7.3/README.md).

## Fixed-workload before/after measurements

The official SDK benchmarks separate 0.7.2/0.7.3 processes on the same machine,
with six identical explicit storyboard times, then three explicit preview times.
Both receive the same default Crimson cross input. All **seven inline PNG hashes
match** between versions.

| Operation                                   |    0.7.2 |    0.7.3 |
| ------------------------------------------- | -------: | -------: |
| First storyboard, including browser startup | 1,851 ms | 1,755 ms |
| Warm storyboard, median of three            | 1,765 ms |   307 ms |
| Warm preview, median of three               | 1,203 ms |    44 ms |

Raw reports and the reproduction command are linked from the example above.
This is one workload on one Linux machine, not a universal latency guarantee.
The renderer still has a cold-start cost. CLI batch reuses a worker; separate
CLI invocations start fresh processes. RGBA-buffer preflight estimates exclude
browser, GPU, encoder and other overhead.

Automatic storyboards are bounded samples and compress pauses; timeline mode or
explicit times retain full-duration context. Numeric equality proves repeatability
or baseline equality on the tested renderer, not artistic correctness. Baselines
can cover a subset of times. A measured activity peak is not a game hit marker.
MCP host image forwarding and external Codex/Claude GUI sessions are not tested
by this protocol suite. Godot resources are generated/checked, without claiming
an engine editor import test in this release.

```bash
npm run format:check
npm run check
node scripts/verify-project-workflows.mjs /path/to/new-gallery
node scripts/verify-agent.mjs /path/to/new-session
node scripts/benchmark-agent.mjs /path/to/vfx-mcp /path/to/new-root /path/to/report.json
node scripts/render-gallery.mjs --out /path/to/new-gallery --thumbnails --showcase
npm pack --ignore-scripts
```
