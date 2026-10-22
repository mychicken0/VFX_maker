# Open-source research and adaptations

## 0.7 authoring improvements

Evidence, pinned repository commits and read-file hashes are recorded in
[adaptations-0.7.json](research/adaptations-0.7.json). Source/documentation review
is distinct from testing the complete upstream desktop applications.

| Source                                                                                  | License                                | Concrete result in this repository                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Material Maker](https://github.com/RodZill4/material-maker)                            | MIT, unless a file specifies otherwise | Studied graph parameters, remote controls and declarative noise/SDF definitions. Added an original bounded binding registry, five procedural field patterns and reusable components. The Godot editor/runtime is not bundled.                                      |
| [Mixture](https://github.com/alelievr/Mixture)                                          | MIT                                    | Studied exposed-parameter overrides and variant hierarchy. Added control/seed snapshots that share one effect's layers. Our looks do not implement inherited external graph assets. No Unity code is bundled.                                                      |
| [TiXL](https://github.com/tixl3d/tixl)                                                  | MIT                                    | Studied parameter snapshots and variation-grid exploration. Added actual-rendered look thumbnails and bounded batch export. Our implementation is original React/TypeScript and does not include TiXL's renderer or parameter blending.                            |
| [PixiJS Filters](https://github.com/pixijs/filters)                                     | MIT                                    | Installed `pixi-filters` 6.1.5, whose peer dependency supports PixiJS 8. Outline, pixelate, color replacement and shockwave are real runtime filters. Ramp, seeded noise warp, dissolve and procedural fields are original shaders. Full npm notices are included. |
| [animation-timeline-control](https://github.com/ievgennaida/animation-timeline-control) | MIT                                    | Studied multi-key selection, range dragging, snapping and canvas timeline interactions. Added an original dope sheet using the existing curve model, history and React UI; this library is not installed.                                                          |

The resulting authoring operations are shared by Studio, CLI, MCP and the typed
API. Presets only provide data. No renderer/simulation branch uses a preset name.
Imported components remain independent editable copies. Pixel Composer remains a
reference for procedural authoring; this release keeps the existing layer UI and
does not claim its full graph/simulation feature set.

TextureLab's GPL source was considered during the shortlist, but no code from it
was incorporated. React Flow and Rete were evaluated as possible graph UI tools;
neither is installed. The implemented human workflow uses simple effect controls
with advanced bindings/modifier settings behind disclosures.

## 0.5 reference review

Reviewed on 2026-10-22. Repository commits and evidence are recorded in
[research/sources.json](research/sources.json). The rows distinguish runtime
packages from sources used to study features. Referenced applications were
reviewed through the indicated source/docs; this is not a claim that their
complete desktop or authenticated product workflows were tested.

| Source                                                                      | License / evidence read                                                                | Result in VFX Maker                                                                                                                                                           |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [UPNG.js](https://github.com/photopea/UPNG.js)                              | MIT; README, encode/decode implementation, license; installed npm 2.1.0                | Actual lossless PNG dependency. Output RGBA is decoded and checked exactly; non-paletted fallback preserves hidden RGB.                                                       |
| [Squoosh](https://github.com/GoogleChromeLabs/squoosh)                      | Apache-2.0; README and image-compression UI/source layout                              | Before/after wipe, explicit size/quality tradeoffs, actual byte savings and local worker processing. Our UI/worker code is original.                                          |
| [Piskel](https://github.com/piskelapp/piskel)                               | Apache-2.0; README, editor/preview/shortcut source organization                        | Reference for pixel-scale preview and editing QoL. Added Fit/Pan/Grid/Snap, keyboard moves, cancel-safe dragging and more reachable controls.                                 |
| [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) | MIT; README and license                                                                | Reference for keyboard resizing, collapse and saved layout. Small original divider implementation; package is not installed.                                                  |
| [Pixelorama](https://github.com/Orama-Interactive/Pixelorama)               | MIT; pinned README and LICENSE                                                         | Palette management, layered animation and CLI-export workflow informed consistent output controls across Studio/CLI/MCP.                                                      |
| [PixiJS Particle Emitter](https://github.com/pixijs/particle-emitter)       | MIT; README and LICENSE                                                                | Reviewed data-driven emitter/config workflows. Compatibility review supports retaining this app's PixiJS 8 renderer and stateless sampler; emitter package is not integrated. |
| [Effekseer](https://github.com/effekseer/Effekseer)                         | MIT; README and LICENSE                                                                | Product-design reference for visual effect editing and game integration. VFX Maker's adapters are baked animations and validated independently.                               |
| [gifenc](https://github.com/mattdesl/gifenc)                                | MIT; installed 1.0.3 source/license                                                    | Existing runtime dependency now supplies one shared RGB palette across animation frames and the optimizer's palette mapping.                                                  |
| [pako](https://github.com/nodeca/pako)                                      | MIT AND Zlib; installed 2.1.0 source/license, plus UPNG's pinned transitive dependency | Bounded inflate validation and straight RGBA/zlib encoding for large atlases.                                                                                                 |

## PixelLab Create VFX

The user-supplied product reference is
[PixelLab Create VFX](https://www.pixellab.ai/create-vfx#). After the configured
network access became available, the actual Chromium visit redirected to
**Sign in - PixelLab**. No account was used and no generation was requested.

The public page HTML identifies “VFX Creator - PixelLab”. Its publicly served
page bundle exposes user-facing labels for canvas resize, effect/preset editing,
linked color changes, frames/FPS/loop controls and GIF/sheet export. Those labels
are source evidence for discoverable controls, not evidence that the
account-only operations were exercised. The bundle URL and SHA-256 are in the
research record. We did not copy its code or assets.

The concrete adaptation here is **Recolor effect**: rotate selected/all layer
hues together, preview with the actual renderer and apply as one undoable edit.
The canvas/output controls also make effect sizing explicit. These are original
implementations using the current layer schema.

[PixelLab's public MCP README](https://github.com/pixellab-code/pixellab-mcp)
describes token-based character/animation/tileset tools. It is a product
reference with an “All rights reserved” notice, not a freely licensed code
dependency and not proof of the Create VFX editor's behavior.

## Integration boundaries

Application code and demonstration textures are original. Runtime packages and
full license texts are listed in [third-party notices](../THIRD_PARTY_NOTICES.md).
Feature references are not bundled into the application. Project settings remain
plain validated data; no rendering branch depends on a preset name.

UPNG's npm CommonJS entry probes browser globals. The Vite configuration adapts
that entry to ESM for both development and production workers, while Node uses
the published package. Large atlases use the app's RGBA/zlib PNG path to bound
palette-analysis costs. PNG results are checked with an independent decoder in
tests, including hidden RGB, partial alpha and palette limits.
