# 0.4 architecture

`src/core` owns Zod schemas, a typed effect API, built-in example data, curves,
gradients and stateless particle sampling. It is usable from Node and browsers.
There are no effect-name branches in simulation or rendering. A stable layer-ID
hash plus project seed and particle index creates independent random cohorts.

`src/render/pixi.ts` owns the PixiJS application, graphics, textured flipbook
sprites and per-layer glow. Projects decode textures before switching scenes.
Stale async scene loads are discarded. Layers share generic graphics routines;
texture frame objects and sprite pools are reused until the scene changes.
`pixi.js/unsafe-eval` installs Pixi's official precompiled/polyfill paths so the
packaged app can keep a CSP without `unsafe-eval`.

`src/render/export.ts` uses that renderer for each exact sample time, reads RGBA
pixels and produces transparent PNGs, padded atlases, GIFs and engine adapters.
GIF uses gifenc, an explicit opaque matte and cumulative centisecond timing.
The last frame may be shorter; metadata and Godot preserve that duration.
Source-pixel/GIF budgets are validated before rendering. ZIP timestamps are
fixed. SHA-256 hashes describe produced files; wall-clock timings are omitted.

`src/editor` is a local-first React app: layers/library/assets, Pixi viewport,
draggable handles, timeline, schema-aware inspector, curve editors, undo/redo,
autosave, JSON editing and cancellable ZIP export. Vite bundles every dependency;
fonts and runtime code require no external CDN. The loopback Studio server has
no filesystem mutation API. Optional initial projects use a random bearer token.

`src/node` provides root-scoped file access, optimistic revisions, direct edits,
CLI, MCP and export jobs. Playwright launches local Chromium, serves the packaged
renderer on an ephemeral loopback port, blocks external page requests, calls the
same browser functions, then closes the browser/server. SwiftShader enables
rendering without hardware GPU or display; real browser rendering is still
required. The official MCP SDK handles protocol framing and schema discovery.

`dist` contains the built browser app, Node executables, public API bundles and
TypeScript declarations. npm packaging includes runtime dependencies by pinned
version/lock, examples and docs. No Rust crate is involved in the 0.4 build or
runtime. Legacy Rust lives in a self-contained subdirectory.
