# VFX Maker as a standalone tool

`vfx` and `vfx-mcp` are installed executables. This repository is their source,
not a runtime workspace. Neither executable reads its build directory, Cargo
manifest, user configuration, or an implicit current project. Project JSON and
exports live in a directory the caller chooses. One installation serves multiple
game repositories, asset folders, and MCP clients.

The Rust 2024 workspace has three crates for the headless tool:

- `vfx-core`: typed project schema, ParticleStream DAG validation, fixed-step
  seeded simulation, data recipes, curves/gradients/fields, CPU reference rendering,
  native GIF/PNG export, atomic storage, command API,
  revision checks, persistent undo/redo, and export.
- `vfx-cli`: Clap adapter; converts arguments to core commands and prints JSON.
- `vfx-mcp`: official `rmcp` SDK adapter over stdio; calls the same core and
  returns structured results and inline PNG previews.

The core modules can be split into more crates when actual consumers justify it.
There is no GUI dependency in either headless binary. The later native editor
will be another adapter to these commands. See [ADR-001](adr/001-portable-tools.md)
for this milestone's ordering relative to the supplied master plan.

## Project and transaction semantics

`.vfxproj` is JSON, with format, schema/engine versions, revision, scene, and up
to 16 prior/future scene snapshots. Presets create ordinary editable nodes and
edges. Stable string node IDs survive array reordering. Emitters produce a
ParticleStream; unary modifiers transform it; one output renderer merges distinct
emitter pipelines. Cycles, orphaned nodes, ambiguous emitter branches, duplicate
IDs, extra fields, unsupported versions and out-of-budget values are rejected.

Every project mutation obtains a nonblocking advisory lock on `<project>.lock`,
reloads the latest project, checks `expected_revision`, edits a candidate scene,
validates it, writes and syncs a temporary file, then atomically replaces the
project. Dry-runs validate the candidate without saving or advancing revision.
Undo/redo are new revisions, not revision rewinds. New edits clear redo history.
Creation and PNG preview writes use atomic no-clobber persistence. Export builds
an entire new directory in staging before renaming it into place. Existing export
directories are protected. Lock files are inert and can remain between runs.

All clients must use the API to participate in revision/lock protection. Manual
JSON edits are possible, but an unrelated editor does not honor advisory locks.
Schema1 engine0.1/0.2 projects remain readable without rewrite. Successful committed
mutations upgrade their engine header; previews, exports and dry-runs preserve
source bytes. Unknown future engine versions are rejected. There is no
idempotency-token cache or full audit log.

## Deterministic simulation and pixels

The default simulation runs at 60 Hz, independent of export FPS. A requested time
samples `floor(time * tick_hz)`; samples belong to `[0, duration)`. Burst particles
are born at tick 0. Stream particle `i` (zero-based) is born at
`ceil((i+1) * tick_hz / rate)`. A particle dies when age reaches its sampled lifetime.
Path and shape emitters schedule births across explicit start/travel times. Path
births follow polyline arc length; shape sampling includes uniform-area disks.
Gravity, drag, attraction, vortex and seeded Perlin turbulence execute in graph
order before semi-implicit position updates. Curves/gradients sample normalized
age. Bounded recent history is recomputed for trails while integrating.
Randomness uses explicitly implemented FNV-1a node IDs and SplitMix64, keyed by
project seed, emitter ID and particle index. Adding another emitter does not
change an existing emitter's random sequence. Emitter IDs define compositing
order. A render Session caches per-particle position/velocity and bounded dense trail
history. Monotonic samples integrate only newly elapsed ticks. Backward scrubs
or wrapped ages restart that particle from its seeded birth state. The immutable
scene/compiled graph borrows prevent reuse across edited scenes. Cached/fresh
pixels are tested equal, including all recipes and timeline boundaries.

Particle sizes are radii in pixels. Colors interpolate as sRGB RGBA bytes; the
renderer converts RGB to linear light for premultiplied compositing, then writes
straight-alpha sRGB PNG. Pixel mode snaps positions and radii. Smooth mode uses
one-pixel edge coverage for circles/quads. Transparent pixels have zero RGB.
Trail segments use a per-particle union mask. Optional glow thresholds and blurs
premultiplied linear-light color/alpha through two separable box-blur passes.
Normal and additive composition are supported; additive energy is clamped to the
PNG range and is not a promise of identical appearance on every background.

Exports sample `t=i/fps` for `i=0..ceil(duration*fps)-1`; the endpoint is excluded.
The final frame's duration is truncated to the project duration. Spritesheets use
a fixed grid with one transparent pixel of padding on each side of every frame.
Metadata records rects, time, duration, pivot, filtering, alpha/color convention,
scene/pixel/file SHA-256 hashes, engine version, seed, backend and revision. It
contains no wall-clock timestamp, so unchanged exports are byte reproducible.
GIF encoding is native through the gif crate: explicit opaque linear-light
matte, integer nearest-neighbor scale, per-frame palettes and cumulative
centisecond timing. GIF repetition is configurable, independently of a scene
being seamless. Native RGBA hashes are labeled before matte/quantization.
Trim/extrusion, seamless-loop authoring and packed atlases are not implemented.

Golden pixel results are checked for this CPU backend and engine version on the
tested Linux x86_64 toolchain. Floating-point math is not promised bit-identical
across all future platforms, compiler versions or GPU backends.

## Filesystem and resource boundaries

Both adapters default `--root` to their working directory. Inputs and outputs must
resolve within that root. Parent traversal and escaping symlinks are rejected;
output parent directories must already exist. MCP has no shell execution,
arbitrary code nodes, network transport, telemetry or LLM dependency. Stdout is
reserved for protocol frames; startup errors go to stderr.

This is an application path policy, not an OS sandbox against another process
maliciously racing filesystem changes. Run untrusted projects in an OS sandbox
when that is required. Resource limits cap file size (4 MiB), graph size, canvas,
particle births, duration, frame count, export pixels and estimated render work
(including modifier applications). Per-frame and cumulative actual raster work
are also bounded, including trails/glow. GIF scaling counts toward output pixels.
Incoming MCP frames are bounded to4MiB. Exports are finite/staged and support
cooperative cancellation/progress. MCP retains up to32 session-scoped jobs,
with2 shared render workers, revision-pinned execution and terminal-job eviction.
Source snapshots are immutable after worker reads. No persistent job daemon or
resumable server-restart queue is included; resource budgets remain fixed.


## Data and dependency boundaries

`recipe.rs` loads the embedded `presets/library.json` or caller-supplied recipe
files, validates the graph and typed stable-ID property bindings, scales generic
node properties and applies explicit final-unit overrides. Core simulation,
rendering and exporting do not depend on preset IDs. External recipe content
is data; no code evaluation is supported. See [recipe guide](RECIPES.md).

The source investigation records15 pinned upstream projects with observed
licenses and actual fetched files. General designs informed independent code;
no engine/editor source or third-party assets were imported. Direct reuse is
through locked Rust dependencies, including `gif` and `noise`. See
[research](OPEN_SOURCE_RESEARCH.md) and [ADR-002](adr/002-data-recipes-and-native-gif.md).

## Asset, image and engine adapters

Embedded PNGs live in Scene.assets, so history snapshots and saved recipes retain
exact texture/grid state. `assets.rs` validates byte/decoded pixel budgets and
expands static PNG into RGBA8. Compiled graphs own bounded decoded assets. No
runtime texture paths or network fetches are allowed. Asset data contributes to
the4MiB project/history file budget; large assets reduce retained edit capacity.

Material modifiers compute texture frame, rotation, scale and layer for each
particle. Stable layer sorting precedes rasterization. Sprite sampling uses
premultiplied linear interpolation; ordered post operations act on straight-alpha
RGBA output, with masks and distortion preserving transparent RGB conventions.

`integration.rs` adapts the baked padded atlas and exact frame durations to
Godot4 SpriteFrames and a Unity2022.3+ Editor importer. These are asset adapters,
not runtime particle-system ports. The Godot resource has been loaded in4.5.1
and validated by scripts/verify_godot.py; Unity execution remains unverified.
See [ADR-003](adr/003-production-authoring.md).
