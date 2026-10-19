# Readiness checks

```bash
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
```

The suite has **60 integration tests**: 52 core, 5 CLI, 3 MCP. Zero-test
binary/library harnesses are excluded. Actual covered behavior includes:

- Atomic batches/dry-runs, stale revisions, competing editors, persisted undo/redo.
- Graph cycles, connections, IDs, nonfinite values, budgets, path traversal,
  escaping symlinks and output overwrite protection.
- Explicit seeded RNG, independent emitters, forward/backward scrubbing and tick
  birth/death rules for burst, stream, scheduled path and shape emitters.
- Arc-length path samples/taper, disk area/ring/box/line spawn domains.
- Linear/smooth/hold key boundaries, RGBA gradients, invalid key data and opacity.
- Attraction, repulsion, vortex directions and deterministic seeded turbulence.
- Bounded replayable trails, visible trail pixels, glow coverage/straight alpha.
- All 18 data recipes validate and render visible pixels; custom recipes and typed
  overrides work; invalid pointers/parameters fail without project creation.
- Canvas scaling and final-unit overrides; incomplete bindings return errors.
- GIF decode, frame count, dimensions, scaling, matte, timing, palette output,
  byte reproducibility, fractional-period rounding and invalid scaled budgets.
- Cumulative actual trail raster overrun cleans staging and publishes no folder.
- Engine0.1 project reads/previews/exports/dry-runs preserve bytes; committed edits
  upgrade the header; unsupported future versions fail.
- A reviewed 64×64 spark at0.2s matches SHA-256 of decoded RGBA:
  `f9624201019cbcb24c1cc8cab835ef362e4699c8fb74c199447945a347fbbc9d`.
- PNG decode, transparent padding, atlas/sequence parity across export FPS.
- Standalone CLI custom-recipe/GIF workflows from unrelated directories without
  display variables; invalid CLI inputs produce machine-readable errors.
- A real official `rmcp` SDK child client discovers22 tools, creates/edits,
  receives inline PNG, exports PNG/GIF, accesses recipes/parameters, undoes/redoes
  and compares with direct core behavior. Wire tests enforce JSON-RPC-only stdout
  and reject input frames exceeding4MiB.

Visual review additionally renders all18 recipes to GIF and transparent atlas
with `scripts/render_gallery.py`. Inspect representative frames and animation;
nonempty pixels and golden hashes alone do not assess artistic quality.

Release checks install both binaries and use them outside the checkout with no
Rust/Cargo/display configuration. Inspect runtime linkage, extract a new Linux
bundle and run its installer. Verify CLI/MCP output parity and archive SHA-256.
The packaging script collects dependency metadata/licenses and fails on missing
license texts; this is an inventory, not a legal opinion.

Linux x86_64 on the current Debian13 environment is verified. Windows/macOS,
external Codex/Claude UI sessions, hosted CI, GPU and native GUI remain unverified.
GitHub Actions is configured; local results do not establish a hosted run.

## 0.3 additions verified

- Actual texture pixels across lifetime/once/loop/ping-pong frame selection.
- Premultiplied bilinear samples, transparent RGB and transformed geometry.
- Explicit layers with screen/multiply blending and stable ID order.
- Palette/dithering/alpha-level enforcement, mask clipping and periodic distortion.
- Invalid PNG/base64/grid/reference and combined decoded-asset budget rejection.
- Revisioned/dry-run asset imports, undo/redo, portable recipes after deleting
  source PNGs, referenced-asset removal rollback.
- High-level material/timeline insertion/update without manual graph rewiring.
- Delayed windows, previous-cycle particles and exact periodic frame replay.
- Cached/fresh equality for all recipes and arbitrary forward/backward scrubbing;
  reduced integration-step count is checked without flaky time thresholds.
- Cooperative cancellation cleans staging for all five export formats.
- Engine adapters match generic atlas pixels and partial final-frame durations.
- Old0.2 projects remain readable without rewrite. Analysis measures actual
  samples, hashes, clipping and optional fresh-render comparison.
- CLI asset/material/timeline/recipe/analysis/engine workflow with JSON stdout
  and separate stderr progress.
- SDK session imports assets, configures material/timeline, saves a recipe,
  analyzes pixels, polls a successful async export, rejects a stale queued
  revision and cancels a running export with staging cleanup.

A separate real-host check uses the checksum-verified official Godot4.5.1 binary:

```bash
python3 scripts/verify_godot.py --godot /path/to/godot \
  --export /path/to/output-from-export-format-godot
```

It imports the PNG, loads SpriteFrames, and verifies atlas dimensions, each frame
rectangle/duration, playback FPS/loop and full duration. This check is additional
to the60 Rust tests. Unity Editor and external Codex/Claude UI sessions were not
available. Wall-time performance measurements describe the tested scene/build
and are not universal speed guarantees.

Source installation also ran from an unrelated folder with a deliberately
unavailable local Rust toolchain selection. The script honored the source pin
and preserved a relative installation prefix containing spaces/Thai characters.
That scenario is included in the GitHub Actions installation step.
