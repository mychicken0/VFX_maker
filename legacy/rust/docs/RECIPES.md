# Data recipes and reusable nodes

The embedded library is [presets/library.json](../presets/library.json). Its
format, default preset/canvas, effect graphs and parameter declarations are data.
Adding a library entry requires no new match arm in simulation/render/export.
An external recipe file needs no rebuild at all.

## Author a custom recipe

```bash
vfx preset show spark_burst --out custom.recipe.json
# Edit custom.recipe.json, retaining its format and schema header.
vfx new custom.vfxproj --preset-file custom.recipe.json \
  --params '{"count":80,"color":[255,30,100,255]}'
vfx preview custom.vfxproj --times 0.1,0.2,0.4 --out custom.png
```

A recipe has `format:"vfxmaker.recipe"`, `schema_version:1`, ID, description,
`scene` and a `parameters` object. `vfx preset show ID` returns a wrapper with
`recipe` and `parameter_defaults`; `--out` saves the bare recipe accepted by
`--preset-file`. `vfx schema recipe` describes the complete file.

A parameter binds an explicit typed value to one or more existing node
properties. For example:

```json
{
  "color": {
    "kind": {"type":"color"},
    "description": "Core color, straight sRGB RGBA bytes",
    "targets": [{"node_id":"color","property":"/start"}]
  },
  "size": {
    "kind": {"type":"number","min":0,"max":32},
    "description": "Starting radius in output pixels",
    "targets": [{"node_id":"size","property":"/start"}]
  }
}
```

Bindings are JSON pointers relative to `node.kind`, resolved by stable node ID.
They can address nested stops/keys, e.g. `/gradient/stops/0/color`. They cannot
add properties or change node type. Supported types: number, unsigned integer,
vec2, ascending range (each with declared bounds), and 4-byte RGBA color.
Default values come from the scene's target properties; catalog defaults show
the first target when a parameter controls several. Overrides apply to every
listed target. Multiple controls addressing overlapping properties apply in
sorted parameter-name order; avoid overlaps for independently adjustable knobs.
The full instantiated graph is validated after all overrides.

No expression language, script, executable, network URL or shell command is
accepted. Limits: 32 parameters, 16 targets per parameter, 4 MiB input. Unknown
parameters, bad pointers/types, extra fields and invalid graphs are errors.

## Units and scaling

Positions are pixels from the top-left; positive Y points down. Angles are
degrees clockwise from positive X. Velocity is pixels/second; force strength is
acceleration magnitude in pixels/second²; size means radius in pixels.

Instantiation scales positions by output/source canvas X/Y ratios and scalar
radii/speeds by the smaller ratio. Forces, attraction softening, vortex radius,
size keys and glow radius follow this scalar scale; turbulence spatial frequency
uses the inverse. Nonuniform canvas resizing changes spatial proportions; it
does not mathematically preserve force trajectories. Values must still satisfy
node ranges, so very large/small resizes can fail. Explicit `params` apply
**after scaling** and use final output units. Seed and pixel mode come from the
creation request, not implicitly from an external file. Defaults are 64×64,
seed 42, pixel mode; specify a recipe's native canvas to reproduce its catalog
composition. `--duration` changes only the simulation window.

## Emitters and graph

Every pipeline has one emitter, zero or more unary modifiers, and feeds a shared
renderer. Renderer merges distinct emitter pipelines. No implicit cloning,
branch-merging of the same emitter, detached nodes or cycles are allowed.

| Node | Behavior |
| --- | --- |
| `emitter_burst` | Count born at time zero; sampled lifetime/speed/angle ranges |
| `emitter_stream` | Finite-window births at rate; first birth is at 1/rate |
| `emitter_path` | Count births traverse a polyline by arc length during start/travel seconds; optional tapered ends |
| `emitter_shape` | Count births sampled in a point, uniform-area disk/perimeter ring, box or line; optional timed schedule |
| `gravity` | Constant acceleration, applied in graph order |
| `drag` | Stable implicit damping with coefficient ≥0 |
| `attractor` | Toward center; negative strength repels; softened distance falloff |
| `vortex` | Tangential acceleration, radial inward/outward component, radius falloff |
| `turbulence` | Two seeded Perlin fields for acceleration; spatial frequency and scrolling noise coordinates |
| `size_over_life`, `color_over_life` | Legacy linear start/end radius and RGBA |
| `size_curve` | Radius from normalized-age scalar curve |
| `opacity_curve` | Multiply current alpha by normalized-age scalar curve |
| `color_gradient` | Replace current color from normalized-age RGBA stops |
| `trail` | Retain bounded recent positions and draw tapered/fading capsule segments |
| `renderer` | Circle/quad heads; normal/additive composition |
| `renderer_glow` | Same renderer plus thresholded, tinted transparent glow |

Birth schedules round up to simulation ticks. Births at the excluded duration
endpoint do not appear in exported frames. Lifetime zero is invalid. Path
segments must be nonzero and contain 2–64 points. Particle lifetime is sampled
independently; path travel describes emission, not motion after birth.

## Curves and gradients

A `curve` contains `keys:[{time,value,interpolation}, ...]`. A `gradient`
contains `stops:[{time,color,interpolation}, ...]`. Both require 2–32 strictly
increasing normalized times, beginning at exactly 0 and ending at exactly 1.
The left key selects interpolation to the next key:

- `linear`: straight interpolation.
- `smooth`: cubic smoothstep, `t*t*(3-2*t)`.
- `hold`: keep the left value until the next key.

Normalized time is particle age/lifetime. Size keys are 0–32 pixels, opacity keys
0–1, color stops RGBA bytes. At a key boundary, its value takes effect exactly.
Color interpolation is in sRGB byte space; subsequent compositing uses linear
light. Modifier ordering matters: a later color node replaces prior color/alpha,
so place multiplicative opacity after the desired color node.

Trails have 0.01–2 seconds history, 2–32 retained points and width scale0.01–4.
Only one trail is allowed per pipeline. History sampling is bounded and
recomputed deterministically during scrubbing. Trails share the particle's
current color and lifetime; they disappear when it dies. A union mask avoids
double alpha at segment joins. Glow has radius1–32, strength0–8, threshold0–0.99
and RGB tint. It uses two separable box-blur passes on premultiplied linear
color/alpha. It is a bounded CPU halo, not a general compositor or HDR bloom.

## Rendering and exporting

For production transparent assets use PNG sequences or padded spritesheets.
GIF composites on an explicit opaque matte, scales with nearest filtering,
quantizes each frame to ≤256 colors and rounds cumulative timing to
centiseconds. It can therefore differ from PNG in color and timing. Metadata
labels native pixel hashes and actual encoded duration separately.

`clipped_particles` estimates heads/history intersecting the canvas boundary;
`bounds` is the actual visible pixel rectangle. These diagnostics do not prove
artistic quality. Inspect rendered pixels and full motion before shipping.
Exports enforce 300-frame, 32-Mi-pixel and work budgets, including scaled GIF
pixels and actual cumulative trail raster work. Reduce canvas, FPS, radius,
particles or history when a budget error is returned; no incomplete export is
published.

## Sprites, materials and timelines (0.3)

See [production workflow](PRODUCTION_WORKFLOW.md) for complete commands. A scene
may embed up to 16 PNG assets as `{png:base64,columns,rows,frames}`. Maximum PNG
size is512KiB, decoded asset size256Ki pixels/1024per side, and combined decoded
assets1Mi pixels. Frames are row-major and the image must divide evenly by the
grid. Static grayscale/RGB/RGBA/palette PNGs are expanded to RGBA8; APNG is rejected.
Source images are treated as sRGB; ICC workflows are not implemented.

`material.settings` defaults to layer0, inherited blend/shape, no sprite, zero
rotation/spin, scale[1,1], no velocity alignment/stretch. Rotation and angular
velocity are sampled ranges, in degrees and degrees/second. Velocity alignment
adds the direction of current velocity; stretch multiplies local X by
`min(16,1+speed*velocity_stretch)`. Scale components are0.05–16. Sprite aspect
ratio is preserved before these scale factors; size controls half-height.
Smooth sampling interpolates premultiplied linear texels to avoid dark fringes.

A sprite references an asset and has playback lifetime/once/loop/ping_pong, FPS,
start_frame and random_start. Lifetime playback spans remaining frames over
particle age/lifetime; once clamps at the final frame, loop wraps, ping-pong
reflects. Random starts use the particle's seeded RNG. `rotation_curve` adds a
normalized-age angle curve, including when no explicit material is present.

Layers sort stably before compositing; equal layers retain emitter-ID order.
Normal/additive/screen/multiply modes composite internally in linear light. The
output renderer still defines the default mode/shape for particles without an
override. Trails inherit blend/layer and current particle color; sprite images
apply to heads, not trail segments.

`timeline.settings` defines delay_seconds, duration_seconds and repeat. Delay
rounds up to a simulation tick; duration must be a whole number of ticks.
Non-repeating windows clip particles when they end. Repeat evaluates previous
cycle particles at wrapped ages, so a stream begins in its periodic steady
state; lifetimes cannot exceed the cycle. Emitter schedules must fit their local
window. This is deterministic repetition; artistic seam quality still depends
on authored curves and birth/death behavior. Export loop metadata is true only
when all pipelines repeat from zero and their periods, including distortion,
divide the full scene duration.

A scene's `post_process` array executes up to8 ordered operations after glow:

- palette:2–64 distinct RGB colors, dither0–1, alpha_levels2–256. Uses a4×4 Bayer
  pattern and nearest linear-RGB palette distance. Output transparent RGB is zero.
- mask:embedded asset, frame, alpha/luminance channel, optional inversion. The
  selected texture frame stretches over the canvas and multiplies alpha.
- wave_distortion:XY pixel displacement amplitudes up to32, spatial frequencies
  in cycles/pixel, and explicit period_seconds. Sampling follows pixel/smooth mode.

Use `set_post_process` to replace the operation list atomically. None of these
operations accepts scripts, shaders or expressions.
