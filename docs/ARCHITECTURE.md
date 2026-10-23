# Architecture

`src/core` owns Zod schemas, a typed effect API, built-in example data, curves,
gradients and stateless particle sampling. It is usable from Node and browsers.
There are no effect-name branches in simulation or rendering. A stable layer-ID
hash plus project seed and particle index creates independent random cohorts.

`src/render/pixi.ts` owns the PixiJS application, graphics, textured flipbook
sprites, sampled cubic Bezier strokes, per-layer masks and glow. Projects decode textures before switching scenes.
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
a file-bound mutation API protected by a random bearer token, revision and
document identity. Save As changes the binding and refuses existing paths.
Native browser handles persist in IndexedDB; disk and browser backups retain
five distinct versions. A journal detects dirty work on reload. Reference and
onion canvases are separate preview layers; the renderer never draws reference
images, and exports strip them from the included project.

`src/node` provides root-scoped file access, optimistic revisions, direct edits,
CLI, MCP and export jobs. Playwright launches local Chromium, serves the packaged
renderer on an ephemeral loopback port, blocks external page requests, calls the
same browser functions, then releases its worker. A pool of at most two isolated browser/page/server workers
reuses warm renderers until 30 idle seconds; cancellation discards only its worker.
CLI exit and MCP shutdown close the pool explicitly. SwiftShader enables
rendering without hardware GPU or display; real browser rendering is still
required. The official MCP SDK handles protocol framing and schema discovery.

`core/spatial.ts` supplies the animated transform used by both Pixi and agent
coordinate conversion. `operations.ts` validates atomic edit sequences on a
clone before a single store transaction. `observation.ts` describes resolved
geometry and macro bindings without embedding texture data. `render/observation.ts`
measures actual composite/isolated alpha, samples bounded representative times
and composes annotated inspection sheets. References appear only in that separate
annotation pass. Clean frame resources use the same straight RGBA encoding as
exports. MCP attaches source revisions, drafts and hashes, with a bounded immutable
image cache, resource/file fallbacks, live guide and workflow prompt. It does not
assume that a host showed its image to a model.

`dist` contains the built browser app, Node executables, public API bundles and
TypeScript declarations. npm packaging includes runtime dependencies by pinned
version/lock, examples and docs.

`creative-schema.ts`, `parameters.ts`, `components.ts` and `creative.ts` own
ordered modifiers, typed macro bindings, control/seed variants and portable
components. Bindings resolve against an explicit target registry on cloned source
layers; validation checks computed limits before writing. Components translate
position bindings and remap layer/asset/group/control IDs on insertion.
`emission.ts` caches bounded first-frame alpha masks for image emitters.

`render/modifiers.ts` adapts selected MIT PixiJS Filters and original deterministic
WebGL shaders. Procedural fields and modifier time derive from seed/layer identity
and explicit sample time. Particle trails resample earlier local positions instead
of retaining frame history. `core/variants.ts` validates batch budgets before
`render/variants.ts` reuses one renderer sequentially. Browser and headless jobs
call the same export routine. Optional start/end ranges produce zero-based
animation timestamps and record their source interval.

The editor presents macro controls first and hides binding configuration behind a
disclosure. Its IndexedDB component store uses schema version 3, checks a 24-item /
24-MiB cap in a write transaction, and provides portable import/download. Looks
and timing use focus-trapped dialogs; multi-channel key editing reuses normalized
curves and atomic project history.

`src/core/pixel-options.ts` defines persistent output settings. `pixels.ts`
validates PNG chunk lengths, checksums, header and inflate budgets before decode.
It performs nearest-neighbor sampling, block pixels, RGB palette quantization,
ordered dithering and separate alpha quantization. `authoring.ts` contains
canvas resizing, gradient/tint hue rotation and grid-checked texture replacement.
`editing.ts` handles flat groups, selection transforms, keyframe insertion and
curve updates. `geometry.ts` simplifies bounded freehand samples and flattens
cubic Bezier segments for the same arc-length path rendering pipeline.
These same functions are exposed through Studio, CLI, MCP and the public API.
`vite.config.ts` adapts the pinned UPNG module's environment probe to ESM for
both development and production workers; dependency source is left untouched.

`core/analysis.ts` validates analysis/baseline schemas; `render/analysis.ts` hashes
straight RGBA and rerenders frames in reverse order. Baselines compare hashes
at their recorded times and canvas dimensions. `preflightExport` is shared by
actual exports and agent preflight. `node/batch.ts` validates independent tasks;
the service pins source snapshots before queueing, with one revision/backup per
edited file, distinct paths, 32 items and a 16-MiB aggregate snapshot cap.
Batch failures retain explicit per-item results and completed writes.

## 0.7.4 authoring surfaces

`editor/Blueprint.tsx` uses the MIT React Flow dependency for graph navigation and
ports. Numeric wires serialize as existing controls/bindings; modifier chains are
the existing renderer order. `parameters.ts` owns connect/disconnect validation and
compact graph description, shared with MCP `get_blueprint` and edit batches.
`geometry.ts` maintains Bezier anchor/handle alignment for point edits.
`editor.blueprint` saves optional node positions; it is never renderer state.

Canvas transform handles, direct curve edits and pen strokes keep transient drafts
inside React and commit once at pointerup. Pointer cancellation discards them.
The canvas uses its measured available dimensions; timeline height and time zoom
are independent of project FPS/duration. Blueprint is lazy-loaded on demand.

`core/stage.ts` defines optional camera/plane placement data, independent from 2D
layer geometry. `render/stage.ts` renders each deterministic Pixi layer onto a
Three.js textured plane, then uses an orthographic or perspective camera. The
common renderer interface feeds preview, parity analysis and all image/game
encoders. Stage is lazy-loaded in a separate `StageStudio` dialog and headless
render bridge; the default 2D renderer never applies camera metadata. Export
preflight additionally checks source-layer pixel work. Node layout and preview
guides are not exported. `view` distinguishes 2D and Stage QA baselines.
