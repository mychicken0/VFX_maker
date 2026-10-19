# Open-source VFX research

Inspected on 2026-10-19. The sources below are pinned to observed Git HEADs, not floating claims about a project. All root/readme/source paths actually fetched are recorded in [sources.json](research/sources.json). External documentation and project text were treated as data, not task instructions.

| Project / pinned revision | License evidence | Design inspected | Implementation direction |
| --- | --- | --- | --- |
| [Ttanasart-pt/Pixel-Composer](https://github.com/Ttanasart-pt/Pixel-Composer/tree/e8f2c002fb54541bb05f30a486b4d2997f1eeabc) `e8f2c002fb54` | MIT root; mixed assets/dependencies checked separately | Editable VFX graphs, particle history and trail paths. | Timed-path emitter and bounded particle trails. |
| [effekseer/Effekseer](https://github.com/effekseer/Effekseer/tree/effd528a5ae5dbc60531c03e290db33e187f815b) `effd528a5ae5` | MIT | Dedicated VFX workflow, gradient parameter loading and baked game exports. | Export metadata and reusable over-life animation data. |
| [Alchemist0823/three.quarks](https://github.com/Alchemist0823/three.quarks/tree/de7c207f791c8b2260c43334a282976221688b1b) `de7c207f791c` | MIT | Serializable piecewise functions and separate simulation/render batching. | JSON keyframe data and data-only preset definitions. |
| [pixijs/particle-emitter](https://github.com/pixijs/particle-emitter/tree/0fffdd9d18cabd99e5ee1d5dc94136613d5fcb04) `0fffdd9d18ca` | MIT | Interpolated/stepped lifetime properties and declarative behavior configuration. | Linear/smooth/hold interpolation and schema-driven recipe parameters. |
| [godotengine/godot](https://github.com/godotengine/godot/tree/81ab961f91066a63bcbf3ec340962bb1a1ada558) `81ab961f9106` | MIT | CPU particle color ramps, seeded randomness and emission-point domains. | Uniform spawn shapes, stable per-emitter RNG and explicit timing. |
| [BabylonJS/Babylon.js](https://github.com/BabylonJS/Babylon.js/tree/1431d93dbd9dd6051575fafcc43db9806d0483c4) `1431d93dbd9d` | Apache-2.0 | Gradient factor/color stops and reusable particle-system settings. | Validated normalized-age gradients and custom recipe files. |
| [cocos/cocos-engine](https://github.com/cocos/cocos-engine/tree/4bbfb6f521936e87284cf5b3e59e6b8139411d7e) `4bbfb6f52193` | MIT (licenses/LICENSE and inspected file headers) | Serializable over-time color/size/force modules. | Reusable property animation nodes instead of effect-name branches. |
| [NatronGitHub/Natron](https://github.com/NatronGitHub/Natron/tree/3763d805d7d277d10af10025ae41af677682b3e6) `3763d805d7d2` | GPL (LICENSE.txt) | Effect-instance boundaries and compositor scheduling concepts. | Architecture reference only; no source code translated, linked or copied. |
| [blender/blender](https://github.com/blender/blender/tree/3c3a99655a5996a6878f9254c621c37bb6061f49) `3c3a99655a59` | GPL (COPYING) | Color/curve mapping as reusable data resources. | Conceptual reference only; no Blender source or assets imported. |
| [image-rs/image](https://github.com/image-rs/image/tree/075e65d618a323e5cb48c1d8710a2eca25d690c6) `075e65d618a3` | MIT OR Apache-2.0 | Frame-based GIF handling and codec integration. | Separate rendering pixels from output encoding. |
| [linebender/tiny-skia](https://github.com/linebender/tiny-skia/tree/5d4754777746eef0828be166896eaf482c49f8f2) `5d4754777746` | BSD-3-Clause | CPU rasterization and clear color/alpha conventions. | Reference for CPU-only path rendering; current renderer remains independent. |
| [cocos2d/cocos2d-x](https://github.com/cocos2d/cocos2d-x/tree/7a5282a301a13e467bdcc3466d3cd3883862aadf) `7a5282a301a1` | MIT (README and inspected source header) | Gravity/radius particle modes, external configuration and reproducible authoring controls. | Generic force nodes and data-based effect recipes. |
| [djeedai/bevy_hanabi](https://github.com/djeedai/bevy_hanabi/tree/77630ff1eed8b104f34e91d23e9440428dc5ab01) `77630ff1eed8` | MIT (observed LICENSE-MIT) | Rust gradients, size/color-over-lifetime output modifiers, and radial/tangent force modules. | Typed gradients/curves, vortex/attractor modifiers; no GPU code imported. |
| [image-rs/image-gif](https://github.com/image-rs/image-gif/tree/a5f89ddc2b29424334244c97456b4a26e208aa7d) `a5f89ddc2b29` | MIT OR Apache-2.0 | Pure-Rust GIF encoder, centisecond delays and frame palettes. | Direct gif crate dependency; standalone GIF export without FFmpeg. |
| [razaekel/noise-rs](https://github.com/razaekel/noise-rs/tree/77de33887620c2a7e7263b1d30ef46afbfe705b6) `77de33887620` | MIT OR Apache-2.0 | Seeded Perlin noise as a reusable procedural field. | Direct noise crate dependency for deterministic turbulence. |

## Reuse boundaries

This work does not vendor or translate source from the researched editors/engines. New engine implementation is independent, with standard algorithms and typed APIs informed by their designs. The gif and noise Rust crates are integrated as dependencies, with locked versions/checksums and their upstream license notices. GPL projects were considered for architecture only. No third-party fonts, visual presets, sample assets, shaders or DLLs are copied. A root license does not establish a license for every bundled asset.

One initial Hanabi repository spelling returned not found; the authoritative repository was then located at djeedai/bevy_hanabi and fetched successfully. Some guessed file paths were unavailable; the manifest records those misses and they are not claimed as inspected files.

## Concrete changes selected

- Store presets as JSON scene recipes with typed, validated parameter bindings; allow caller-supplied recipe files. No per-effect branching in simulation/render/export.
- Add reusable normalized-age curves and color gradients, including step/linear/smooth interpolation.
- Add shape emission, softened attraction, vortex forces and seeded turbulence.
- Retain bounded particle history for trails; add optional transparent linear-light glow.
- Encode GIF directly using the upstream Rust encoder, with explicit scale/matte/timing and output budgets.
- Keep CLI and MCP on the same command API and verify actual exported frames and standalone installations.

Implementation and verification outcomes are recorded separately; this research inventory does not claim every upstream feature has been ported.
