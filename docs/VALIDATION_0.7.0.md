# 0.7.0 validation

Verified on 2026-10-22 with Node 24.19.0, Linux, local Chromium/SwiftShader and
Godot 4.6.3. Results describe executed checks, not an artist usability study or
benchmarks against upstream applications.

## Automated checks

- TypeScript check and production build pass.
- **56 unit tests** cover validation, sampling, PNG handling, storage, backups,
  macro resolution/order, safe binding targets, component origins/ID remapping,
  asset reuse, variants, image emission, timing and multi-key transactions.
- **41 browser scenarios** pass in the full suite. They include the previous
  saving/recovery/masks/reference/export regressions and new shader compilation,
  deterministic fields/trails, modifier order, exact preview/export RGBA,
  component persistence, controls/one-step undo/cancellation, look comparison,
  multi-key editing, auto key and narrow/short-screen dialogs.
- After hardening control-definition order and stripping the reference from the
  batch's base source file, all 10 creative UI/CLI/MCP scenarios were repeated.
- Formatting and `git diff --check` pass. Runtime `npm audit --omit=dev` reports
  zero vulnerabilities at the time of this check.

## Installed tools and engine files

The installable tarball was installed under `/workspace/.vfx-js-tools`, separate
from the source checkout. Four CLI/MCP workflows were repeated with
`VFX_TEST_BIN_DIR` selecting those installed executables. Projects use temporary
folders, including a Thai path with spaces. Tests exercise schemas, revision
conflicts, all export formats, asset processing, modifiers/controls, component
save/insert, inline image previews and queued variant exports through the official
MCP SDK client. All four pass. The package reports version 0.7.0.

Godot 4.6.3 imported a procedural Void portal export trimmed to 0.15–0.86 seconds.
The engine loaded every AtlasTexture region and SpriteFrames entry and verified
frame rate, looping and individual durations: **22 frames / 0.71 seconds**.
Unity output is exercised as files and metadata; Unity Editor was not run.

## Actual showcase renders

The gallery script rendered all **22 templates** with the real PixiJS renderer,
including GIF and transparent atlases. README embeds nine GIFs at 2× output size.
Every GIF was independently parsed with gifuct-js and contains 36 frames.
SHA-256/byte counts match [the manifest](../examples/showcase/manifest.json), and
each accompanying project equals the current parsed template data. Files can be
regenerated with:

```bash
npm run build
node scripts/render-gallery.mjs --out /path/to/new-gallery --thumbnails --showcase
```

The showcase and screenshots are application renders. They are not synthetic
mockups or output from the reference projects.

## Scope and limits

Linux/Chromium and the protocol client are verified. macOS, Windows, Firefox,
Safari, external Codex/Claude GUI configuration and every GPU are not covered.
Shader arithmetic may differ across GPU implementations. Controls validate their
current computed values; a later slider value can be rejected if it exceeds a
layer or particle budget. Layer Inspector fields remain source values before
controls. New bindings and values remain plain validated data.

Components are independent editable copies. Looks share source layers and store
control values/seed; they do not store separate whole projects or external linked
components. The local component library belongs to the browser origin and has a
24-item / 24-MiB limit; use portable downloads for backups. Batches are limited to
8 looks, 32 million source pixels and 64 MiB of generated output. Trails sample in
local emitter space and are capped at 16,000 segments per cycle. Original project
and export budgets still apply.

See [release behavior](RELEASE_0.7.0.md),
[upstream evidence](research/adaptations-0.7.json), and the repository's
[Actions runs](https://github.com/mychicken0/VFX_maker/actions) for hosted checks.
