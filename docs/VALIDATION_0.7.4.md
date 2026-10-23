# 0.7.4 release validation

Validation platform: Node 24.19.0, Linux and Chromium/SwiftShader.

The release checks cover 81 unit tests and 79 browser/CLI/MCP scenarios. The
0.7.4-specific cases exercise actual screen interactions, rather than checking
only whether labels and buttons exist:

- Fresh canvas-first defaults, larger fit preview, remembered text sizes,
  no page overflow at 390px and short-window Canvas focus.
- Timeline divider movement beyond 400px, horizontal zoom/scroll/fit and
  focus/restore. A scrubber remains usable with the panel folded.
- Canvas rotation/scale, cancellation, single undo, and rotation of multiple
  selected layers while preserving other layers.
- Pen drawing, point insert/delete/smooth with aligned Bezier handles, exact
  point fields and dragging real Inspector curve keys.
- Dragging an actual control output to a layer input, editing its wire,
  evaluated renderer values, node position save/reload and narrow Blueprint UI.
- Separate camera scene, orbit/placement/save/undo/recovery, duplicated and
  removed plane placements, Stage export cancellation and 390px controls.
- Exact projected preview/export RGBA, unchanged default 2D pixels, reverse-order
  Stage parity, distinct view baselines and real stdio camera draft/commit/export.
- Real stdio MCP graph discovery, atomic dry run, draft observation, revisioned
  commit, exact clean PNG equality, reverse-order parity and baseline comparison.

Existing cases still cover real rendered/exported RGBA, GIF/atlas/sequence/game
resources, modifiers, masks, references, native browser file handles, connected
Save/Save As, backups/recovery/conflicts, macro controls/variants, 64-layer layouts,
16-project batch jobs, cancellation isolation, numeric budget errors and installed
CLI/MCP entrypoints. UI tests explicitly open optional panels for detailed editing;
separate tests check their folded initial state.

## Reproducible agent evidence

[The checked-in MCP example](../examples/blueprint-agent/README.md) contains the
actual editable project, graph, exact edits, before/draft/after PNGs, storyboard,
GIF, Godot resource, transcript, QA baseline and run manifest. The run reports
40 tools, unchanged dry-run source, identical draft/commit PNG hashes, parity
success and baseline equality after moving only node layout. One browser served
eight render requests. Those images and the generated Studio/Blueprint screenshots
were opened for visual inspection.

All 22 templates are re-exported as GIFs and atlases. Nine README GIF hashes remain
identical to the previous release; their editable projects/manifests now carry
0.7.4. This confirms no unintended effect-rendering change from the UI work.

## Distribution checks and scope

The release includes an installable npm archive and Studio ZIP. The ZIP's local
Node launcher is exercised from a fresh directory outside the checkout, including
first-install and second-launch behavior. 28 installed scenarios use the packaged Studio
and CLI/MCP, and every built distribution file is compared byte-for-byte with the installed build.

Node is required; the ZIP is not a bundled desktop executable. Windows/macOS
launch scripts are included but were not run on those operating systems. This
suite does not test an external Codex/Claude GUI client's image forwarding or
Godot editor import. GPU/driver differences can affect a saved pixel baseline;
parity proves repeatability on the tested renderer, not artistic quality.

Reproduction:

```bash
npm run format:check
npm run check
node scripts/verify-blueprint-agent.mjs /path/to/new-session
node scripts/render-gallery.mjs --out /path/to/new-gallery --thumbnails --showcase
node scripts/render-stage-gallery.mjs /path/to/new-stage-gallery
npm pack --ignore-scripts
node scripts/package-release.mjs /path/to/release-assets
```
