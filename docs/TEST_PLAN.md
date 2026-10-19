# Readiness checks

```bash
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
```

The suite has **38 integration tests**: 32 core, 4 CLI, 2 MCP. Zero-test
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
- All 12 data recipes validate and render visible pixels; custom recipes and typed
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
- A real official `rmcp` SDK child client discovers13 tools, creates/edits,
  receives inline PNG, exports PNG/GIF, accesses recipes/parameters, undoes/redoes
  and compares with direct core behavior. Wire tests enforce JSON-RPC-only stdout
  and reject input frames exceeding4MiB.

Visual review additionally renders all12 recipes to GIF and transparent atlas
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
