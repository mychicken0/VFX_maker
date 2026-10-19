use crate::{Error, Result, graph::Compiled, model::*, simulation};
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct FrameStats {
    pub requested_time: f64,
    pub sampled_time: f64,
    pub particles: usize,
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

fn linear(v: f64) -> f64 {
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}
fn srgb(v: f64) -> f64 {
    if v <= 0.0031308 {
        v * 12.92
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    }
}

pub fn frame(scene: &Scene, graph: &Compiled, time: f64) -> Result<Frame> {
    let particles = simulation::snapshot(scene, graph, time)?;
    let (w, h) = (scene.canvas.width, scene.canvas.height);
    let mut pixels = vec![[0.0_f64; 4]; (w * h) as usize];
    let mut mask = if particles.iter().any(|p| p.trail.len() > 1) {
        vec![0.0; (w * h) as usize]
    } else {
        vec![]
    };
    let mut touched = vec![];
    let mut work = 0;
    for particle in &particles {
        if particle.radius <= 0.0 || particle.color[3] <= 0.0 {
            continue;
        }
        if particle.trail.len() > 1 && particle.trail_width > 0.0 {
            paint_trail(
                particle,
                &scene.canvas,
                graph.blend,
                &mut pixels,
                &mut mask,
                &mut touched,
                &mut work,
            )?;
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
                    dest[c] = match graph.blend {
                        Blend::Normal => rgb[c] * a + dest[c] * (1.0 - a),
                        Blend::Additive => (dest[c] + rgb[c] * a).min(1.0),
                    };
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
            clipped_particles: particles
                .iter()
                .filter(|p| {
                    p.color[3] > 0.0
                        && p.radius > 0.0
                        && (p.position[0] - p.radius < 0.0
                            || p.position[1] - p.radius < 0.0
                            || p.position[0] + p.radius > f64::from(w)
                            || p.position[1] + p.radius > f64::from(h)
                            || p.trail.iter().any(|a| {
                                a[0] < 0.0
                                    || a[1] < 0.0
                                    || a[0] >= f64::from(w)
                                    || a[1] >= f64::from(h)
                            }))
                })
                .count(),
            bounds: if count == 0 { None } else { Some(bounds) },
        },
    })
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
            dest[c] = match blend {
                Blend::Normal => rgb[c] * alpha + dest[c] * (1.0 - alpha),
                Blend::Additive => (dest[c] + rgb[c] * alpha).min(1.0),
            };
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
