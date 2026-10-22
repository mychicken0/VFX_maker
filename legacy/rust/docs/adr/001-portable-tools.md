# ADR-001: standalone CLI and MCP before the native editor

Status: accepted for the first implementation milestone.

The user explicitly requested an installed tool usable across projects, through
both Terminal and Codex/Claude MCP. Prioritize the master plan's permitted
agent-heavy ordering: headless core, minimal MCP, then native GUI. Source checkout
paths must never be runtime dependencies. Installation copies two executables
into a user-selected prefix. All state remains in explicitly chosen project files.

Use the CPU reference renderer first, with actual transparent PNG and atlas
exports, to keep the installed tools independent of display servers, native
graphics libraries and hardware GPUs. This implements the plan's CPU fallback;
it does not replace the planned `wgpu`/WGSL renderer or `eframe`/`egui-snarl` editor.
Their compatibility spike and Linux GUI validation remain outstanding.

Keep the first core in modules within one crate rather than introducing empty
crates for each planned subsystem. CLI/MCP adapters already share the typed
command and validation implementation. Use `rmcp` and `rmcp-macros` 3.3.0, lock all
dependencies, and pin Rust 1.99.1. No Pixel Composer source, assets, fonts or
binaries are imported.

Validation: automated core/CLI tests, an actual official SDK MCP client session,
raw protocol framing checks, reviewed rendered pixels, and installation followed
by use outside the source checkout. Final outcomes are recorded in TEST_PLAN.md.
