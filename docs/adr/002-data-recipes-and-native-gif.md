# ADR-002: Data recipes, reusable animation and native GIF

Status: implemented for0.2.0.

The tool must create varied effects across arbitrary game folders and MCP hosts.
A fixed list of hand-coded effect constructors would require a new application
release for each visual variation. An external video encoder would also weaken
the standalone runtime promise.

Store graph recipes and parameter bindings in versioned JSON. Embed the default
library for installation independence, and load caller-authored files within the
chosen root. Validate before instantiation; scale generic node properties then
apply typed final-unit overrides. No simulation/render/export branch depends on
an effect name. Existing projects contain a complete scene snapshot.

Represent over-life animation as shared curves/gradients. Add generic emission
shapes, paths, forces, bounded trails and optional transparent glow. Their CPU
reference implementations serve every recipe and preserve the legacy golden.
Use upstream `noise` for seeded procedural fields and `gif` for native encoding,
keeping dependencies locked with their notices.

GIF uses an explicit opaque matte and integer nearest-neighbor scaling. Frame
delays round cumulative centisecond boundaries to avoid systematic drift.
Transparent PNG remains the game-asset output. New output directories are staged
and published atomically; estimated and actual work limits prevent oversized
requests from leaving partial outputs.

Maintain read compatibility with schema1 engine0.1.0. Read-only calls/dry-runs do
not rewrite old projects. Only successful committed mutations advance revision
and record the current engine header. Unknown future versions remain errors.

Tradeoffs: no arbitrary expressions, custom imported sprites or general image
compositor yet. Recipe parameters use explicit property pointers rather than
scripts. Scrubbing recomputes simulation from origin; large scenes are bounded
rather than silently downsampled. GIF quantization/timing differ from native
PNG, with those stages clearly labeled in metadata.
