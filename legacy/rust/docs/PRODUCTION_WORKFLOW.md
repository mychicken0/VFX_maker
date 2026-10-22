# Authoring and delivery workflow

VFX Maker is a standalone headless authoring tool. Terminal and MCP operate on
ordinary portable project files. The runtime is CPU-based and offline; a GUI,
GPU backend, general shader graph and runtime engine particle port are not part
of this release.

## Import and configure a sprite

Create a project in a chosen asset folder. Put your source PNG in that folder,
then import it with the current project revision:

```bash
vfx new effect.vfxproj --preset spark_burst
vfx asset import effect.vfxproj --file sheet.png --id sprite \
  --columns 3 --rows 2 --frames 6 --expected-revision 0
vfx material effect.vfxproj --emitter emitter --expected-revision 1 \
  --settings '{"sprite":{"asset":"sprite","playback":"lifetime"},"rotation_degrees":[-30,30],"angular_velocity":[-90,90],"layer":3}'
vfx preview effect.vfxproj --times 0.1,0.25,0.4,0.6 --out preview.png
```

Import copies the PNG into the project, preserving grid and frame count. The
source file can then move or disappear. Asset updates and material/timeline
configuration participate in atomic revisions and undo/redo. Reimporting the
same ID replaces its asset only when the resulting scene is valid. A changed
frame count that invalidates a reference fails without rewriting the project.

The high-level commands find the selected emitter's pipeline, update an existing
modifier or insert one before the renderer. They do not require manual edge
rewiring. `settings` is a complete settings object: omitted fields take their
default values, so inspect an existing material before replacing one aspect.
For more complex graph changes use a typed atomic patch.

Sprite modes:

| Playback | Behavior |
| --- | --- |
| lifetime | Span the remaining frames over normalized particle age |
| once | Advance at FPS and hold the final frame |
| loop | Advance at FPS and wrap |
| ping_pong | Advance forward/backward, without duplicating end frames |

Default sprite FPS is12, start_frame0, random_start false. Pixel mode uses nearest
sampling; smooth mode uses premultiplied linear bilinear sampling. Texture colors
multiply particle RGB, and texture alpha multiplies particle alpha. Default white
particle RGB preserves source image colors.

`rotation_degrees` and `angular_velocity` are sampled min/max ranges. To orient
sparks along their movement and stretch them by speed:

```json
{"sprite":{"asset":"sprite"},"align_velocity":true,"velocity_stretch":0.025,"scale":[1,0.7],"layer":2,"blend":"additive"}
```

Size is half-height; source aspect ratio is preserved before XY scale. A
rotation_curve node can add age-based rotation. Layers sort before compositing;
equal layers retain stable emitter-ID order. Normal, additive, screen and multiply
are internal layer blend modes. PNG is the final baked composite.

## Time charge, impact and decay

Use separate emitters for distinct phases; each can have its own local clock:

```bash
vfx timeline effect.vfxproj --emitter emitter --expected-revision 2 \
  --settings '{"delay_seconds":0.1,"duration_seconds":0.7,"repeat":false}'
```

Delay rounds up to a simulation tick. Window duration must span whole ticks and
fit the scene for non-repeating playback. Particle motion and over-life curves
use local age. A non-repeating window cuts off its particles when it ends.

For periodic effects, set repeat true with delay0. Repeating streams include
particles from the previous cycle; this avoids starting from an artificially
empty frame. Lifetimes must not exceed the cycle, and path/shape birth schedules
must fit it. Repeat is deterministic, with continuity tested across cycle wraps.
A visually smooth seam also requires appropriate birth/death alpha and curves;
repeating a burst with an opaque first frame intentionally repeats that flash.

`energy_orb_loop` and `masked_portal` demonstrate periodic authoring.
`charge_impact` demonstrates delayed independent phases. Scene duration remains
the export window; a duration override does not retime all nodes automatically.

## Mask, distort and constrain colors

Replace the ordered post-processing array with one atomic patch:

```bash
vfx patch effect.vfxproj --expected-revision 3 --ops '[
  {"op":"set_post_process","effects":[
    {"type":"wave_distortion","amount":[1.5,0],"frequency":[0.06,0],"period_seconds":0.7},
    {"type":"palette","colors":[[100,10,20],[220,40,25],[255,130,25],[255,245,170]],"dither":0.15,"alpha_levels":8}
  ]}
]'
```

Operations run after glow, in listed order. Palette matching uses linear-RGB
distance, with a fixed Bayer spatial pattern for repeatable dithering. Alpha
levels are quantized separately. Transparent RGB stays zero. The palette promise
applies to native PNG; GIF matte/quantization can introduce other colors.

A mask operation references an embedded PNG asset and frame, choosing alpha or
premultiplied luminance, optionally inverted. The selected frame stretches over
the canvas with edge-clamped sampling and multiplies output alpha. Wave distortion
uses XY pixel amplitudes, spatial frequencies in cycles/pixel and a period in
seconds. Its sampling follows pixel/smooth mode; displaced canvas edges are
transparent. Post effects are data, with no expression/code evaluation.

## Inspect pixels and measure work

```bash
vfx analyze effect.vfxproj --samples 12 --compare-fresh --json
```

Analysis renders actual samples and reports hashes, blank/clipped samples,
simulation steps, cache hits and measured milliseconds. `--compare-fresh` also
renders from birth for every sample, verifies native RGBA equality and measures
its relative time. The time ratio is scene/machine dependent; compare integration
steps to understand how much simulation was reused. Timings are not stored in
reproducible asset export manifests.

The render Session reuses per-particle kinematics and bounded history when moving
forward. Backward scrubbing and wrapped ages reset the affected particle. Tests
compare fresh/cached pixels for every bundled recipe and arbitrary sample order.
Blank frames or clipping may be intentional; diagnostics require visual judgment.

## Run a cancellable MCP export

The normal `vfx_export` call is synchronous. For a long job, inspect revision
then call `vfx_start_export`:

```json
{
  "export":{"project":"effect.vfxproj","out":"game-assets-v1","format":"godot","fps":25},
  "expected_revision":4
}
```

Use the actual returned job_id with `vfx_get_export_job`. A successful job exposes
the usual output result; a failed one exposes the stable error code/message.
`vfx_cancel_export_job` requests cancellation. Poll until cancelled before
assuming staging cleanup; publication can win a late cancellation race.

Two workers are shared with synchronous rendering, and32 jobs are retained per
server. Completed jobs are evicted first. The source revision is checked when a
worker executes and its scene snapshot is then immutable. Progress has phase,
completed and total. Job state is session-scoped; completed folders are durable,
while server restarts do not resume queued jobs. The CLI can emit progress events
on stderr using `export --progress`, preserving machine-readable JSON on stdout.

## Deliver game assets

```bash
vfx export effect.vfxproj --format spritesheet --fps 25 --out png-assets
vfx export effect.vfxproj --format godot --fps 25 --out godot-assets
vfx export effect.vfxproj --format unity --fps 25 --out unity-assets
vfx recipe save effect.vfxproj --out reusable.recipe.json \
  --id my_effect --description 'My reusable textured effect'
```

All formats use the same padded native frames and exact duration metadata.
Godot4 output contains SpriteFrames, imported texture and instructions. Copy the
folder into a Godot project, let texture import finish and assign effect.tres to
an AnimatedSprite2D. Choose nearest texture filtering for pixel art. The resource
has been loaded in Godot4.5.1 and checked for rectangles, durations, FPS and loop.

Unity output contains a C# Editor importer for Unity2022.3+ and the2D Sprite
package. Copy the complete folder under Assets, select metadata.json and use
Assets > VFX Maker > Import selected metadata. It slices the PNG, converts
coordinates, preserves existing sprite IDs, and creates a new animation clip
with a terminal hold key. Existing clips receive no automatic overwrite. Assign
the resulting clip through your game's SpriteRenderer/Animator workflow. This
host integration is generated and inspected, but Unity was not available to run
it here.

A saved recipe includes scene/assets/post operations, excluding project history.
Its parameter declarations initially start empty; add bindings using the recipe
schema when reusable knobs are needed. Creation uses caller-supplied canvas,
seed and pixel mode; supply the native values to reproduce an authored recipe.

## Limits and compatibility

Projects/recipes/MCP input are bounded to4MiB. Assets are at most512KiB encoded
PNG each,256Ki decoded pixels per image,1Mi total decoded pixels and16 entries.
History snapshots include asset state and count toward the project-file limit.
Large images can therefore reduce the number of edits that fit in history; an
over-limit save fails without changing the existing project.

Other limits include64 nodes,4096 particle births,10 seconds,300 export frames,
32Mi output pixels and bounded estimated/actual work. Engine atlases are at most
8192 per side. Reduce canvas, frames, particle count, history length or size when
limits are exceeded. No partial output folder is published on failure/cancellation.

Schema1 projects from0.1/0.2 remain readable and exportable without rewriting.
Only committed mutations advance revision and the engine header. Linux x86_64 is
validated. Windows/macOS, external Codex/Claude UI sessions and Unity host
execution remain unverified. These boundaries do not prevent use of the same
installed tools across arbitrary project folders on the supported platform.
