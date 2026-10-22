# ADR-003: Portable textures, layered timing and managed render work

Status: implemented for0.3.0.

The0.2 primitive-only renderer and synchronous export interface constrained both
visual range and agent workflows. Adding more presets alone would retain those
limits. Keep the standalone CPU architecture and extend generic scene data.

Embed static PNG assets and flipbook grids in Scene. Validate encoded/decoded
limits before rendering; retain asset state in undo/redo and portable recipes.
Compiled graphs own decoded textures, with no external runtime image paths.
Material modifiers define sprite playback, transforms, layers and blend overrides.
High-level material/timeline commands insert/update nodes atomically so clients
need not manually rewire graphs for common authoring operations.

Add local timeline windows and periodic particle ages. Repeating streams include
previous-cycle particles, with lifetime restricted to one cycle. Deterministic
repeat is separate from artistic seam quality. Ordered post operations provide
palette/dithering, alpha/luminance masks and bounded wave distortion.

Use a per-request render Session to cache kinematics and bounded dense trail
history. It integrates only new ticks for monotonic samples and resets particles
when ages rewind. Verify fresh/cached pixel equality, including wrapped clocks;
measure actual speed rather than assert universal wall-time thresholds.

Exports accept cooperative control/progress, checking before atomic publication.
MCP exposes bounded session-scoped jobs with a pinned expected revision,2 shared
workers,32 retained jobs and cancellation cleanup. Completed assets outlive the
server, while job state does not. No independent daemon is required.

Game adapters consume the baked atlas/manifest. Godot4 uses native SpriteFrames;
Unity uses an explicit Editor importer rather than undocumented serialized asset
YAML. The actual Godot4.5.1 resource is verified. Unity execution remains pending
an installed host. These outputs are baked animations, not runtime particle ports.

Tradeoffs: CPU resource budgets remain fixed; large assets also consume the
project/history file budget. No GUI/GPU, general shader language, sub-emitter
system or persistent job database is claimed. The current adapters preserve the
portable CLI/MCP workflow instead of introducing a mandatory application service.
