# 0.7.2 validation

Executed on 2026-10-22 with Node 24.19.0 and Linux Chromium/SwiftShader.

## Actual MCP task

The baseline server already returned an inline PNG. The missing pieces were
structured scene context, coordinate conventions, layer bounds/timing and a way
to inspect proposed edits before saving. A clean preview at 0.94 seconds was
empty because the Crimson cross had already faded; its active frames rendered.

An official SDK client launched the stdio server in a separate effects folder.
Returned images were saved and opened during development. After inspecting the
storyboard, the task reshaped both strokes using canvas points and reduced center
particles. The first draft was inspected, then particle size/opacity were reduced
further before committing. The same generic operations were replayed by
`scripts/verify-agent.mjs`, with assertions and a saved protocol transcript.

![Committed effect, coordinates and IDs](../examples/agent-workflow/final.png)

[Result, GIF, recipe, coordinate JSON and hashes](../examples/agent-workflow/README.md).
The replay verifies: draft and dry run do not write, predicted/committed revision
match, one backup is created, resource hashes match, clean draft/committed PNGs
match, text-only delivery can save an image, macro bindings are reported and a
background GIF job succeeds. Images, drafts and saved files remain distinguished.

## Automated checks

- **64 unit tests:** existing validation/storage/simulation plus animated and
  macro-controlled coordinate conversion, normalized points/Bezier vectors,
  stale-handle clearing, batch rollback/indexed errors, locks through raw patches,
  alpha bounds/crops, sampling limits, image cache provenance/eviction and reading
  0.7.1 projects/components.
- **58 browser/CLI/MCP scenarios:** five new agent scenarios plus existing Studio,
  narrow/short layouts, Effects scrolling, native keyboard actions, Save/Save As,
  crash recovery, undo, masks, references, shaders, assets, exports, components,
  controls and timing.
- **25 scenarios repeated with installed executables/web assets**, started from
  a separate directory: seven CLI/MCP workflows, two agent-renderer scenarios,
  twelve library/layout scenarios and four Studio workflows. They select the tarball's executables rather than
  source entrypoints.
- Formatting, TypeScript and production build pass. All **22 templates** render
  as GIFs and atlases. The nine README GIFs are regenerated from checked-in editable
  projects; annotation/agent changes preserve those effect GIF pixels.

The new protocol cases verify inline/structured/resource delivery, the live guide
and prompt, masked point picking, front-to-back hits, hidden/not-started/outside
states, automatic visible timing, explicit empty frames, crop mapping, references
excluded from clean pixels, exact PNG export pixels, stale revision rejection,
failed second-operation rollback, backup count, fresh-path/root restrictions,
expired-image errors and CLI operation files outside the checkout. A 512 × 512,
32-layer, nine-frame observation completes through the SDK within its response
budget. Large layer sheets disclose all 23 omitted IDs while keeping metadata
for 32 layers. Annotated sheets obey their side/pixel/PNG-byte limits.
Single-pixel crops keep a readable draft header and time caption instead of
shrinking their annotation sheet to the size of the crop.

```bash
npm run format:check
npm run check
node scripts/verify-agent.mjs /path/to/new-session
node scripts/render-gallery.mjs --out /path/to/new-gallery --thumbnails --showcase
npm pack --ignore-scripts
```

The installed-server replay accepts its executable as the second argument.
`scripts/mcp-session.mjs` provides a long-lived manual SDK session so resource URIs
remain valid between inspection and follow-up edits. The CI workflow runs the full
source checks and retains browser artifacts on success as well as failure.

These are real protocol/browser checks and a manually inspected task, not an
external-model benchmark. Codex/Claude GUI sessions and every host's image forwarding
have not been validated. Text-only models cannot visually judge a PNG; metadata
and image fallback delivery do not change that limitation. Automatic sampling is
bounded, picks describe isolated alpha before occlusion, and cached resources/jobs
do not survive server restart. Cross-platform font/GPU behavior needs separate
validation.
