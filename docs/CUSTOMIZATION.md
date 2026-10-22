# Customize without a graph

A project is a canvas, playback settings, embedded textures and an ordered list
of layers. Array order is bottom to top. Layers have stable IDs, so changing a
display name or reordering does not change their random sequence.

## Layers

| Type      | Main controls                                                                                                    | Typical use                                |
| --------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| particles | burst/stream/path, spawn region, lifetime, velocity, gravity, drag, turbulence, size/color/opacity, spin/stretch | Sparks, fire, smoke, trails                |
| path      | local points, width curve, draw progress, taper, closed shape                                                    | Sword cuts, lightning, magic ribbons       |
| ring      | radius/width curves, arc, segments                                                                               | Shockwaves, halos, polygonal runes         |
| sprite    | embedded texture, dimensions, flipbook playback                                                                  | Hand-painted animation or textured effects |

All layers support position, rotation, scale, blend, glow, delay, duration and
repeat. Motion curves add X/Y offsets and rotation in degrees and multiply the
base scale. These curves use normalized layer time. Particle size/color/opacity
use each particle's normalized age; this lets stream particles fade individually.

Curve keys are `{t, value, ease}` with strictly increasing `t` in 0..1. Easing
belongs to the outgoing interval: `linear`, `smooth` (smoothstep), or `hold`.
Values outside key times hold their endpoints. Color stops are `{t, color}` with
six-digit sRGB hex colors. Interpolation currently occurs in sRGB, not linear
light. Positions and sizes are canvas pixels; particle size is half-height.

## TypeScript API

```ts
import {
  defineEffect,
  particles,
  ring,
  curve,
  colors,
  arcPoints,
} from "vfx-maker";

const hue = "#40d9ff";
export default defineEffect({
  name: "Custom arc",
  seed: 123,
  duration: 1.4,
  fps: 30,
  layers: [
    particles({
      id: "arc",
      name: "Arc sparks",
      mode: "path",
      points: arcPoints(40, 200, 400, 32),
      travel: 0.7,
      count: 100,
      gravity: { x: 0, y: 0 },
      size: curve(3, 0),
      colors: colors("#ffffff", hue),
    }),
    ring({
      id: "halo",
      name: "Halo",
      start: 0.4,
      radius: curve(8, 45),
      width: curve(4, 0),
      colors: colors(hue),
    }),
  ],
});
```

Use `vfx build source.ts --out effect.vfx.json` from the folder containing the
source. `--root` can point to another folder. The module's default export is a
project or a function returning a project (async allowed). This executes trusted
Node code. `vfx-maker` resolves to the installed tool's own API, even when the
caller has no package.json or node_modules.

`defineEffect`, `particles`, `path`, `ring` and `sprite` validate and supply
defaults. `curve`, `colors`, `arcPoints`, `evaluate`, `pointOnPath`, `random` and
the schemas are exported. Type declarations ship with the package.

## Extend the renderer

For completely new layer behavior, edit the discriminated schema in
`src/core/model.ts`, the corresponding renderer branch in `src/render/pixi.ts`
and controls in `src/editor/Inspector.tsx`. React/Vite hot reload supports rapid
iteration; `npm run build` packages it for CLI/MCP. There is no runtime plugin
loader or sandboxed shader editor in this release. An effect module composes
the supported layers; it does not inject executable callbacks into projects.

## Limits and repeat behavior

Projects support 32 layers, 4000 particle births per cycle, 8 textures with one
million combined decoded pixels, 4 MiB serialized files, 16..512px canvas sides,
10 seconds and 300 frames. Export additionally caps source pixels at 16 million
and scaled GIF pixels at 32 million. Keys: 32 per curve; points: 64 per path.

Repeat wraps local time. Particle layers reuse the same cohort each cycle and
include previous-cycle particles at time zero; maximum particle lifetime must
fit in the cycle. Stream rate times duration determines cohort size. Suitable
size/opacity endpoints are needed for a visually seamless loop. Global loop
controls playback/export repetition; it does not make a burst seamless.

Gravity and drag use an analytic trajectory. Turbulence is a seeded smooth
oscillating acceleration, not a fluid simulation. Sampling is stateless: seeking
or changing frame rate does not accumulate simulation error. Exact pixels are
verified within the tested Chromium/SwiftShader version; GPU/driver/browser
versions may differ in rasterization, filters and PNG encoding.
