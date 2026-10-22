use crate::control::RenderControl;
use crate::{Error, Result, graph::Compiled, model::*, simulation};
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct FrameStats {
    pub requested_time: f64,
    pub sampled_time: f64,
    pub particles: usize,
    pub simulation_steps: u64,
    pub cache_hits: usize,
    pub nontransparent_pixels: usize,
    pub alpha_coverage: f64,
    pub clipped_particles: usize,
    pub raster_work_units: u64,
    pub bounds: Option<[u32; 4]>,
}

pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    pub stats: FrameStats,
}

pub(crate) fn linear(v: f64) -> f64 {
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}
pub(crate) fn srgb(v: f64) -> f64 {
    if v <= 0.0031308 {
        v * 12.92
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    }
}

pub struct Session<'a> {
    scene: &'a Scene,
    graph: &'a Compiled,
    cache: simulation::SimulationCache,
}
impl<'a> Session<'a> {
    pub fn new(scene: &'a Scene, graph: &'a Compiled) -> Self {
        Self {
            scene,
            graph,
            cache: Default::default(),
        }
    }
    pub fn frame(&mut self, time: f64, control: &RenderControl) -> Result<Frame> {
        let particles =
            simulation::cached_snapshot(self.scene, self.graph, time, &mut self.cache, control)?;
        raster(
            self.scene,
            self.graph,
            time,
            particles,
            (self.cache.steps, self.cache.hits),
            control,
        )
    }
}
pub fn frame(scene: &Scene, graph: &Compiled, time: f64) -> Result<Frame> {
    Session::new(scene, graph).frame(time, &RenderControl::default())
}
fn raster(
    scene: &Scene,
    graph: &Compiled,
    time: f64,
    particles: Vec<simulation::Particle>,
    simulation_work: (u64, usize),
    control: &RenderControl,
) -> Result<Frame> {
    let (w, h) = (scene.canvas.width, scene.canvas.height);
    let mut pixels = vec![[0.0_f64; 4]; (w * h) as usize];
    let mut mask = if particles.iter().any(|p| p.trail.len() > 1) {
        vec![0.0; (w * h) as usize]
    } else {
        vec![]
    };
    let mut touched = vec![];
    let mut work = 0;
    let mut clipped_particles = 0;
    for particle in &particles {
        control.check()?;
        if particle.radius <= 0.0 || particle.color[3] <= 0.0 {
            continue;
        }
        let blend = particle
            .appearance
            .as_ref()
            .and_then(|a| a.blend)
            .unwrap_or(graph.blend);
        if particle.trail.len() > 1 && particle.trail_width > 0.0 {
            paint_trail(
                particle,
                &scene.canvas,
                blend,
                &mut pixels,
                &mut mask,
                &mut touched,
                &mut work,
            )?;
        }
        if let Some(appearance) = &particle.appearance {
            clipped_particles += usize::from(paint_appearance(
                particle,
                appearance,
                &scene.canvas,
                graph,
                &mut pixels,
                &mut work,
                control,
            )?);
            continue;
        }
        if particle.position[0] - particle.radius < 0.0
            || particle.position[1] - particle.radius < 0.0
            || particle.position[0] + particle.radius > f64::from(w)
            || particle.position[1] + particle.radius > f64::from(h)
            || particle
                .trail
                .iter()
                .any(|a| a[0] < 0.0 || a[1] < 0.0 || a[0] >= f64::from(w) || a[1] >= f64::from(h))
        {
            clipped_particles += 1;
        }
        let pixel = scene.canvas.pixel_mode;
        let [cx, cy] = particle
            .position
            .map(|p| if pixel { p.floor() + 0.5 } else { p });
        let radius = if pixel {
            particle.radius.round().max(0.5)
        } else {
            particle.radius
        };
        let x0 = (cx - radius - 1.0).floor().clamp(0.0, f64::from(w)) as u32;
        let x1 = (cx + radius + 1.0).ceil().clamp(0.0, f64::from(w)) as u32;
        let y0 = (cy - radius - 1.0).floor().clamp(0.0, f64::from(h)) as u32;
        let y1 = (cy + radius + 1.0).ceil().clamp(0.0, f64::from(h)) as u32;
        raster_budget(&mut work, u64::from(x1 - x0) * u64::from(y1 - y0))?;
        let rgb = [
            linear(particle.color[0]),
            linear(particle.color[1]),
            linear(particle.color[2]),
        ];
        for y in y0..y1 {
            for x in x0..x1 {
                let dx = (f64::from(x) + 0.5 - cx).abs();
                let dy = (f64::from(y) + 0.5 - cy).abs();
                let distance = match graph.shape {
                    Shape::Circle => (dx * dx + dy * dy).sqrt(),
                    Shape::Quad => dx.max(dy),
                };
                let coverage = if pixel {
                    if distance <= radius { 1.0 } else { 0.0 }
                } else {
                    (radius + 0.5 - distance).clamp(0.0, 1.0)
                };
                let a = particle.color[3] * coverage;
                if a == 0.0 {
                    continue;
                }
                let dest = &mut pixels[(y * w + x) as usize];
                for c in 0..3 {
                    dest[c] = blend_channel(rgb[c], a, dest[c], dest[3], blend);
                }
                dest[3] = a + dest[3] * (1.0 - a);
            }
        }
    }
    if let Some(glow) = &graph.glow {
        raster_budget(&mut work, u64::from(w) * u64::from(h) * 16)?;
        apply_glow(&mut pixels, w, h, glow);
    }
    let mut rgba = Vec::with_capacity((w * h * 4) as usize);
    let mut count = 0;
    let mut bounds = [w, h, 0, 0];
    for (index, p) in pixels.iter().enumerate() {
        let alpha = (p[3] * 255.0).round() as u8;
        for value in p.iter().take(3) {
            rgba.push(if alpha == 0 {
                0
            } else {
                (srgb((value / p[3]).clamp(0.0, 1.0)) * 255.0).round() as u8
            });
        }
        rgba.push(alpha);
        if alpha > 0 {
            count += 1;
            let x = index as u32 % w;
            let y = index as u32 / w;
            bounds[0] = bounds[0].min(x);
            bounds[1] = bounds[1].min(y);
            bounds[2] = bounds[2].max(x + 1);
            bounds[3] = bounds[3].max(y + 1);
        }
    }
    raster_budget(
        &mut work,
        crate::post::work(&scene.post_process, u64::from(w) * u64::from(h)),
    )?;
    crate::post::apply(
        &mut rgba,
        &scene.canvas,
        &scene.post_process,
        &graph.assets,
        time,
        control,
    )?;
    if !scene.post_process.is_empty() {
        count = 0;
        bounds = [w, h, 0, 0];
        for (index, p) in rgba.as_chunks::<4>().0.iter().enumerate() {
            if p[3] > 0 {
                count += 1;
                let x = index as u32 % w;
                let y = index as u32 / w;
                bounds[0] = bounds[0].min(x);
                bounds[1] = bounds[1].min(y);
                bounds[2] = bounds[2].max(x + 1);
                bounds[3] = bounds[3].max(y + 1);
            }
        }
    }
    control.check()?;
    Ok(Frame {
        width: w,
        height: h,
        rgba,
        stats: FrameStats {
            requested_time: time,
            sampled_time: (time * f64::from(scene.simulation.tick_hz) + 1e-9).floor()
                / f64::from(scene.simulation.tick_hz),
            particles: particles.len(),
            nontransparent_pixels: count,
            alpha_coverage: count as f64 / f64::from(w * h),
            raster_work_units: work,
            clipped_particles,
            simulation_steps: simulation_work.0,
            cache_hits: simulation_work.1,
            bounds: if count == 0 { None } else { Some(bounds) },
        },
    })
}

fn blend_channel(source: f64, alpha: f64, dest: f64, dest_alpha: f64, blend: Blend) -> f64 {
    match blend {
        Blend::Normal => source * alpha + dest * (1.0 - alpha),
        Blend::Additive => (dest + source * alpha).min(1.0),
        Blend::Screen | Blend::Multiply => {
            let d = if dest_alpha > 0.0 {
                dest / dest_alpha
            } else {
                0.0
            };
            let mixed = if matches!(blend, Blend::Screen) {
                source + d - source * d
            } else {
                source * d
            };
            source * alpha * (1.0 - dest_alpha) + dest * (1.0 - alpha) + mixed * alpha * dest_alpha
        }
    }
}
fn paint_appearance(
    p: &simulation::Particle,
    a: &simulation::Appearance,
    canvas: &Canvas,
    graph: &Compiled,
    pixels: &mut [[f64; 4]],
    work: &mut u64,
    control: &RenderControl,
) -> Result<bool> {
    let (w, h) = (canvas.width, canvas.height);
    let pixel = canvas.pixel_mode;
    let radius = if pixel {
        p.radius.round().max(0.5)
    } else {
        p.radius
    };
    let center = p.position.map(|v| if pixel { v.floor() + 0.5 } else { v });
    let image = a.sprite.as_ref().map(|id| &graph.assets[id]);
    let aspect = image.map_or(1.0, |image| {
        let (w, h) = image.frame_size();
        f64::from(w) / f64::from(h)
    });
    let scale = [a.scale[0] * aspect, a.scale[1]];
    let half = [radius * scale[0], radius * scale[1]];
    let (cos, sin) = (a.rotation.cos(), a.rotation.sin());
    let extent = [
        half[0] * cos.abs() + half[1] * sin.abs(),
        half[0] * sin.abs() + half[1] * cos.abs(),
    ];
    let x0 = (center[0] - extent[0] - 1.0)
        .floor()
        .clamp(0.0, f64::from(w)) as u32;
    let x1 = (center[0] + extent[0] + 1.0)
        .ceil()
        .clamp(0.0, f64::from(w)) as u32;
    let y0 = (center[1] - extent[1] - 1.0)
        .floor()
        .clamp(0.0, f64::from(h)) as u32;
    let y1 = (center[1] + extent[1] + 1.0)
        .ceil()
        .clamp(0.0, f64::from(h)) as u32;
    raster_budget(work, u64::from(x1 - x0) * u64::from(y1 - y0))?;
    let tint = [linear(p.color[0]), linear(p.color[1]), linear(p.color[2])];
    let blend = a.blend.unwrap_or(graph.blend);
    for y in y0..y1 {
        control.check()?;
        for x in x0..x1 {
            let d = [
                f64::from(x) + 0.5 - center[0],
                f64::from(y) + 0.5 - center[1],
            ];
            let local = [cos * d[0] + sin * d[1], -sin * d[0] + cos * d[1]];
            let (rgb, alpha) = if let Some(image) = image {
                let uv = [
                    0.5 + local[0] / (2.0 * half[0]),
                    0.5 + local[1] / (2.0 * half[1]),
                ];
                let sampled = image.sample(a.frame, uv, !pixel);
                if sampled[3] <= 0.0 {
                    continue;
                }
                (
                    [
                        sampled[0] / sampled[3] * tint[0],
                        sampled[1] / sampled[3] * tint[1],
                        sampled[2] / sampled[3] * tint[2],
                    ],
                    sampled[3] * p.color[3],
                )
            } else {
                let point = [local[0] / scale[0], local[1] / scale[1]];
                let distance = match a.shape.unwrap_or(graph.shape) {
                    Shape::Circle => point[0].hypot(point[1]),
                    Shape::Quad => point[0].abs().max(point[1].abs()),
                };
                let coverage = if pixel {
                    if distance <= radius { 1.0 } else { 0.0 }
                } else {
                    (radius + 0.5 - distance).clamp(0.0, 1.0)
                };
                (tint, coverage * p.color[3])
            };
            if alpha <= 0.0 {
                continue;
            }
            let dest = &mut pixels[(y * w + x) as usize];
            for c in 0..3 {
                dest[c] = blend_channel(rgb[c], alpha, dest[c], dest[3], blend);
            }
            dest[3] = alpha + dest[3] * (1.0 - alpha);
        }
    }
    Ok(center[0] - extent[0] < 0.0
        || center[1] - extent[1] < 0.0
        || center[0] + extent[0] > f64::from(w)
        || center[1] + extent[1] > f64::from(h)
        || p.trail
            .iter()
            .any(|v| v[0] < 0.0 || v[1] < 0.0 || v[0] >= f64::from(w) || v[1] >= f64::from(h)))
}

fn raster_budget(work: &mut u64, pixels: u64) -> Result<()> {
    *work = work.saturating_add(pixels);
    if *work > MAX_RENDER_WORK {
        return Err(Error::new(
            "LIMIT_EXCEEDED",
            "Actual raster work exceeded the frame budget; reduce trail length, width or particles",
        ));
    }
    Ok(())
}

fn paint_trail(
    particle: &simulation::Particle,
    canvas: &Canvas,
    blend: Blend,
    pixels: &mut [[f64; 4]],
    mask: &mut [f64],
    touched: &mut Vec<usize>,
    work: &mut u64,
) -> Result<()> {
    let w = canvas.width;
    let h = canvas.height;
    let r = particle.trail_width;
    let n = particle.trail.len() - 1;
    for (i, pair) in particle.trail.windows(2).enumerate() {
        let a = pair[0].map(|v| {
            if canvas.pixel_mode {
                v.floor() + 0.5
            } else {
                v
            }
        });
        let b = pair[1].map(|v| {
            if canvas.pixel_mode {
                v.floor() + 0.5
            } else {
                v
            }
        });
        let d = [b[0] - a[0], b[1] - a[1]];
        let length = d[0] * d[0] + d[1] * d[1];
        if length < 1e-12 {
            continue;
        }
        let x0 = (a[0].min(b[0]) - r - 1.0).floor().clamp(0.0, f64::from(w)) as u32;
        let x1 = (a[0].max(b[0]) + r + 1.0).ceil().clamp(0.0, f64::from(w)) as u32;
        let y0 = (a[1].min(b[1]) - r - 1.0).floor().clamp(0.0, f64::from(h)) as u32;
        let y1 = (a[1].max(b[1]) + r + 1.0).ceil().clamp(0.0, f64::from(h)) as u32;
        raster_budget(work, u64::from(x1 - x0) * u64::from(y1 - y0))?;
        for y in y0..y1 {
            for x in x0..x1 {
                let p = [f64::from(x) + 0.5 - a[0], f64::from(y) + 0.5 - a[1]];
                let t = ((p[0] * d[0] + p[1] * d[1]) / length).clamp(0.0, 1.0);
                let u = (i as f64 + t) / n as f64;
                let radius = r * u;
                let distance = (p[0] - d[0] * t).hypot(p[1] - d[1] * t);
                let coverage = if canvas.pixel_mode {
                    if distance <= radius.round().max(0.5) {
                        u
                    } else {
                        0.0
                    }
                } else {
                    (radius + 0.5 - distance).clamp(0.0, 1.0) * u
                };
                if coverage <= 0.0 {
                    continue;
                }
                let index = (y * w + x) as usize;
                if mask[index] == 0.0 {
                    touched.push(index);
                }
                mask[index] = mask[index].max(coverage);
            }
        }
    }
    let rgb = [
        linear(particle.color[0]),
        linear(particle.color[1]),
        linear(particle.color[2]),
    ];
    for index in touched.drain(..) {
        let alpha = particle.color[3] * mask[index];
        mask[index] = 0.0;
        let dest = &mut pixels[index];
        for c in 0..3 {
            dest[c] = blend_channel(rgb[c], alpha, dest[c], dest[3], blend);
        }
        dest[3] = alpha + dest[3] * (1.0 - alpha);
    }
    Ok(())
}

fn blur(source: &[[f64; 4]], w: u32, h: u32, r: u32, horizontal: bool) -> Vec<[f64; 4]> {
    let mut out = vec![[0.0; 4]; source.len()];
    let (lines, length) = if horizontal { (h, w) } else { (w, h) };
    let index = |line: u32, p: u32| {
        if horizontal {
            (line * w + p) as usize
        } else {
            (p * w + line) as usize
        }
    };
    let denominator = f64::from(r * 2 + 1);
    for line in 0..lines {
        let mut sum = [0.0; 4];
        for p in 0..=r.min(length - 1) {
            for (c, v) in sum.iter_mut().enumerate() {
                *v += source[index(line, p)][c];
            }
        }
        for p in 0..length {
            out[index(line, p)] = sum.map(|v| v / denominator);
            if p >= r {
                for (c, v) in sum.iter_mut().enumerate() {
                    *v -= source[index(line, p - r)][c];
                }
            }
            if p + r + 1 < length {
                for (c, v) in sum.iter_mut().enumerate() {
                    *v += source[index(line, p + r + 1)][c];
                }
            }
        }
    }
    out
}

fn apply_glow(pixels: &mut [[f64; 4]], w: u32, h: u32, glow: &Glow) {
    let tint = glow.tint.map(|v| linear(f64::from(v) / 255.0));
    let mut halo: Vec<_> = pixels
        .iter()
        .map(|p| {
            let peak = p[0].max(p[1]).max(p[2]);
            let intensity = if p[3] > 0.0 {
                ((peak / p[3] - glow.threshold) / (1.0 - glow.threshold)).clamp(0.0, 1.0)
            } else {
                0.0
            };
            [
                p[0] * tint[0] * intensity,
                p[1] * tint[1] * intensity,
                p[2] * tint[2] * intensity,
                p[3] * intensity,
            ]
        })
        .collect();
    for _ in 0..2 {
        halo = blur(&halo, w, h, glow.radius, true);
        halo = blur(&halo, w, h, glow.radius, false);
    }
    for (p, g) in pixels.iter_mut().zip(halo) {
        let behind = 1.0 - p[3];
        let alpha = (g[3] * glow.strength).clamp(0.0, 1.0);
        for c in 0..3 {
            p[c] += (g[c] * glow.strength).clamp(0.0, alpha) * behind;
        }
        p[3] += alpha * behind;
    }
}

pub fn png_bytes(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>> {
    let mut bytes = vec![];
    {
        let mut encoder = png::Encoder::new(&mut bytes, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_source_srgb(png::SrgbRenderingIntent::Perceptual);
        let mut writer = encoder.write_header()?;
        writer.write_image_data(rgba)?;
    }
    Ok(bytes)
}

/// Composite straight-alpha sRGB pixels on an opaque matte in linear light.
pub fn matte(rgba: &[u8], background: [u8; 3]) -> Vec<u8> {
    let background = background.map(|v| linear(f64::from(v) / 255.0));
    let mut out = Vec::with_capacity(rgba.len());
    for p in rgba.as_chunks::<4>().0 {
        let alpha = f64::from(p[3]) / 255.0;
        for c in 0..3 {
            out.push(
                (srgb(linear(f64::from(p[c]) / 255.0) * alpha + background[c] * (1.0 - alpha))
                    * 255.0)
                    .round()
                    .clamp(0.0, 255.0) as u8,
            );
        }
        out.push(255);
    }
    out
}
