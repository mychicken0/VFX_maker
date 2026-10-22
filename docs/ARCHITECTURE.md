# Architecture

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
PNG frames and atlases are assembled as straight RGBA buffers to preserve
palette/alpha values without canvas premultiplication rounding. Small PNGs use
UPNG lossless encoding, verify exact RGBA, and fall back to non-paletted output
when needed. Large atlases use a bounded RGBA/zlib encoder. GIF uses gifenc, an
explicit opaque matte and cumulative centisecond timing. Animation palettes
are sampled across all frames and reused to avoid independent palette changes.
The last frame may be shorter; metadata and Godot preserve that duration.
Source/output/atlas pixel budgets are validated before rendering. ZIP timestamps are
fixed. SHA-256 hashes describe produced files; wall-clock timings are omitted.

`src/editor` is a local-first React app: layers/library/assets, Pixi viewport,
draggable handles, timeline, schema-aware inspector, curve editors, undo/redo,
autosave, IndexedDB recent projects, JSON editing and cancellable ZIP export.
Sidebars resize or collapse; small windows switch to drawers. Modal focus stays
inside the dialog and background controls are inert. History retains at most
50 snapshots and 16 MiB of estimated serialized UTF-16 data per direction.
Project serialization and inspector callbacks are memoized during playback.
Pixel optimization runs in a separate worker; replacing settings terminates
stale work. Object URLs are revoked and renderers destroyed on close. Vite bundles every dependency;
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
version/lock, examples and docs.

`src/core/pixel-options.ts` defines persistent output settings. `pixels.ts`
validates PNG chunk lengths, checksums, header and inflate budgets before decode.
It performs nearest-neighbor sampling, block pixels, RGB palette quantization,
ordered dithering and separate alpha quantization. `authoring.ts` contains
canvas resizing, gradient/tint hue rotation and grid-checked texture replacement.
These same functions are exposed through Studio, CLI, MCP and the public API.
`vite.config.ts` adapts the pinned UPNG module's environment probe to ESM for
both development and production workers; dependency source is left untouched.
