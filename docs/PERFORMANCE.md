# Measured incremental rendering

Measured on2026-10-20 in the current Debian13 Linux x86_64 cloud worker, using
Rust1.99.1 optimized release binaries. The fixture is
[forces.recipe.json](../examples/benchmarks/forces.recipe.json):64×64,400 particles,
60Hz,1second, three turbulence fields plus vortex, gravity and drag. Analysis
samples32 times in increasing order, then renders each time fresh for comparison.

| Run | Cached render | Fresh render | Measured ratio |
| --- | --- | --- | --- |
| 1 | 13.68ms | 62.40ms | 4.56× |
| 2 | 12.14ms | 58.14ms | 4.79× |
| 3 | 11.44ms | 53.91ms | 4.71× |

Median measured ratio: **4.71× for this scene/build**. All three runs produced
identical cached/fresh RGBA hashes for every sample. Integration steps dropped
from366,400 to23,200. These work counts are deterministic for this fixture;
wall-time ratios vary with scene, rendering cost, worker load and hardware.
Glow/large textures/post effects can dominate time and benefit less from the
simulation cache. No universal speed guarantee is implied.

Reproduce from the repository root with installed tools:

```bash
vfx_bench_dir="$(mktemp -d)"
cp examples/benchmarks/forces.recipe.json "$vfx_bench_dir/forces.recipe.json"
vfx --root "$vfx_bench_dir" new benchmark.vfxproj --preset-file forces.recipe.json
vfx --root "$vfx_bench_dir" analyze benchmark.vfxproj --samples 32 --compare-fresh --json
```

The reported total_render_ms sums measured cached render calls; baseline contains
fresh_render_ms, simulation-step count, pixel_parity and measured_speedup.
analysis_elapsed_ms also includes hashing/report construction and the optional
baseline work. Setup, PNG/GIF encoding and CLI launch are excluded from the
render-call timing. Measurements are not written into reproducible export files.
