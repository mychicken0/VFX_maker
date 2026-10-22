use crate::control::RenderControl;
use crate::{Error, Result, graph::Compiled, model::*};
use noise::{NoiseFn, Perlin};
use std::collections::{BTreeMap, VecDeque};

#[derive(Clone, Debug, PartialEq)]
pub struct Particle {
    pub position: [f64; 2],
    pub radius: f64,
    pub color: [f64; 4],
    pub trail: Vec<[f64; 2]>,
    pub trail_width: f64,
    pub appearance: Option<Appearance>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Appearance {
    pub layer: i32,
    pub blend: Option<Blend>,
    pub shape: Option<Shape>,
    pub sprite: Option<String>,
    pub frame: u32,
    pub rotation: f64,
    pub scale: [f64; 2],
}
#[derive(Default)]
pub(crate) struct SimulationCache {
    particles: BTreeMap<(String, u32), Kinematics>,
    pub steps: u64,
    pub hits: usize,
}
struct Kinematics {
    tick: u32,
    position: [f64; 2],
    velocity: [f64; 2],
    history: VecDeque<(u32, [f64; 2])>,
}

// FNV-1a IDs + SplitMix64: explicit algorithm, no OS or wall-clock randomness.
fn id_hash(id: &str) -> u64 {
    id.bytes().fold(0xcbf29ce484222325, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x100000001b3)
    })
}
struct Random(u64);
impl Random {
    fn unit(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut n = self.0;
        n = (n ^ (n >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        n = (n ^ (n >> 27)).wrapping_mul(0x94d049bb133111eb);
        n ^= n >> 31;
        ((n >> 11) as f64) * (1.0 / ((1u64 << 53) as f64))
    }
    fn sample(&mut self, range: [f64; 2]) -> f64 {
        range[0] + (range[1] - range[0]) * self.unit()
    }
}

fn path_position(points: &[[f64; 2]], along: f64) -> [f64; 2] {
    let length: f64 = points
        .windows(2)
        .map(|p| (p[1][0] - p[0][0]).hypot(p[1][1] - p[0][1]))
        .sum();
    let mut remaining = length * along;
    for pair in points.windows(2) {
        let segment = (pair[1][0] - pair[0][0]).hypot(pair[1][1] - pair[0][1]);
        if remaining <= segment {
            let t = remaining / segment;
            return [
                pair[0][0] + (pair[1][0] - pair[0][0]) * t,
                pair[0][1] + (pair[1][1] - pair[0][1]) * t,
            ];
        }
        remaining -= segment;
    }
    points[points.len() - 1]
}

fn spawn_position(shape: &SpawnShape, random: &mut Random) -> [f64; 2] {
    match shape {
        SpawnShape::Point { position } => *position,
        SpawnShape::Circle {
            center,
            radius,
            edge,
        } => {
            let angle = random.unit() * std::f64::consts::TAU;
            let r = radius * if *edge { 1.0 } else { random.unit().sqrt() };
            [center[0] + angle.cos() * r, center[1] + angle.sin() * r]
        }
        SpawnShape::Box { min, max } => [
            random.sample([min[0], max[0]]),
            random.sample([min[1], max[1]]),
        ],
        SpawnShape::Line { start, end } => {
            let t = random.unit();
            [
                start[0] + (end[0] - start[0]) * t,
                start[1] + (end[1] - start[1]) * t,
            ]
        }
    }
}

pub fn snapshot(scene: &Scene, graph: &Compiled, time: f64) -> Result<Vec<Particle>> {
    cached_snapshot(
        scene,
        graph,
        time,
        &mut SimulationCache::default(),
        &RenderControl::default(),
    )
}
pub(crate) fn cached_snapshot(
    scene: &Scene,
    graph: &Compiled,
    time: f64,
    cache: &mut SimulationCache,
    control: &RenderControl,
) -> Result<Vec<Particle>> {
    control.check()?;
    cache.steps = 0;
    cache.hits = 0;
    if !time.is_finite() || time < 0.0 || time >= scene.simulation.duration_seconds {
        return Err(Error::new(
            "INVALID_TIME",
            "Sample time must be finite and in [0, duration_seconds)",
        ));
    }
    let hz = f64::from(scene.simulation.tick_hz);
    let sample_tick = (time * hz + 1e-9).floor() as u32;
    let dt = 1.0 / hz;
    let mut particles = vec![];
    for pipeline in &graph.pipelines {
        control.check()?;
        let timeline = pipeline.modifiers.iter().find_map(|m| {
            if let NodeKind::Timeline { settings } = m {
                Some(settings)
            } else {
                None
            }
        });
        let (sample_tick, cycle) = if let Some(t) = timeline {
            let delay = (t.delay_seconds * hz - 1e-9).ceil().max(0.0) as u32;
            if sample_tick < delay {
                continue;
            }
            let elapsed = sample_tick - delay;
            let ticks = (t.duration_seconds * hz).round() as u32;
            if !t.repeat && elapsed >= ticks {
                continue;
            }
            if t.repeat {
                (elapsed % ticks, Some(ticks))
            } else {
                (elapsed, None)
            }
        } else {
            (sample_tick, None)
        };
        let default_material = Material::default();
        let material = pipeline
            .modifiers
            .iter()
            .find_map(|m| {
                if let NodeKind::Material { settings } = m {
                    Some(settings)
                } else {
                    None
                }
            })
            .or_else(|| {
                pipeline
                    .modifiers
                    .iter()
                    .any(|m| matches!(m, NodeKind::RotationCurve { .. }))
                    .then_some(&default_material)
            });
        let noise_field = pipeline
            .modifiers
            .iter()
            .any(|m| matches!(m, NodeKind::Turbulence { .. }))
            .then(|| {
                let seed = (scene.simulation.seed ^ id_hash(&pipeline.emitter.id)) as u32;
                (Perlin::new(seed), Perlin::new(seed.wrapping_add(1)))
            });
        let trail_config = pipeline.modifiers.iter().find_map(|m| match m {
            NodeKind::Trail {
                seconds,
                max_points,
                width_scale,
            } => Some(((seconds * hz).ceil() as u32, *max_points, *width_scale)),
            _ => None,
        });
        let (count, rate, lifetime, speed, angle, origin, sweep) = match pipeline.emitter.kind {
            NodeKind::EmitterBurst {
                count,
                lifetime,
                speed,
                angle_degrees,
                origin,
            } => (count, None, lifetime, speed, angle_degrees, origin, None),
            NodeKind::EmitterStream {
                rate,
                lifetime,
                speed,
                angle_degrees,
                origin,
            } => (
                ((f64::from(cycle.unwrap_or(sample_tick)) * rate / hz) + 1e-9).floor() as u32,
                Some(rate),
                lifetime,
                speed,
                angle_degrees,
                origin,
                None,
            ),
            NodeKind::EmitterPath {
                count,
                ref points,
                start_seconds,
                travel_seconds,
                lifetime,
                speed,
                angle_degrees,
                taper,
            } => (
                count,
                None,
                lifetime,
                speed,
                angle_degrees,
                points[0],
                Some((points, start_seconds, travel_seconds, taper)),
            ),
            NodeKind::EmitterShape {
                count,
                lifetime,
                speed,
                angle_degrees,
                ..
            } => (
                count,
                None,
                lifetime,
                speed,
                angle_degrees,
                [0.0, 0.0],
                None,
            ),
            _ => unreachable!("compiled emitter"),
        };
        for index in 0..count {
            control.check()?;
            let along = if count > 1 {
                f64::from(index) / f64::from(count - 1)
            } else {
                0.0
            };
            let birth_tick = if let NodeKind::EmitterShape {
                start_seconds,
                travel_seconds,
                ..
            } = pipeline.emitter.kind
            {
                (((start_seconds + along * travel_seconds) * hz) - 1e-9)
                    .ceil()
                    .max(0.0) as u32
            } else if let Some((_, start, travel, _)) = sweep {
                (((start + along * travel) * hz) - 1e-9).ceil().max(0.0) as u32
            } else {
                rate.map_or(0, |r| {
                    ((f64::from(index + 1) * hz / r) - 1e-9).ceil() as u32
                })
            };
            let birth_tick = cycle.map_or(birth_tick, |ticks| birth_tick % ticks);
            if cycle.is_none() && birth_tick > sample_tick {
                continue;
            }
            let age_ticks = cycle.map_or_else(
                || sample_tick - birth_tick,
                |ticks| (sample_tick + ticks - birth_tick) % ticks,
            );
            let age = f64::from(age_ticks) * dt;
            let mut random = Random(
                scene.simulation.seed
                    ^ id_hash(&pipeline.emitter.id)
                    ^ u64::from(index).wrapping_mul(0xd6e8feb86659fd93),
            );
            let life = random.sample(lifetime);
            let velocity = random.sample(speed);
            let angle = random.sample(angle).to_radians();
            if age >= life {
                continue;
            }
            let mut position = sweep.map_or(origin, |(points, ..)| path_position(points, along));
            if let NodeKind::EmitterShape { ref shape, .. } = pipeline.emitter.kind {
                position = spawn_position(shape, &mut random);
            }
            let mut velocity = [velocity * angle.cos(), velocity * angle.sin()];
            let history_ticks = trail_config.map_or(0, |(ticks, ..)| ticks);
            let key = (pipeline.emitter.id.clone(), index);
            let previous = cache.particles.remove(&key).filter(|p| p.tick <= age_ticks);
            let (start_step, mut history) = if let Some(p) = previous {
                position = p.position;
                velocity = p.velocity;
                cache.hits += 1;
                (p.tick + 1, p.history)
            } else {
                let mut h = VecDeque::new();
                if trail_config.is_some() {
                    h.push_back((0, position));
                }
                (1, h)
            };
            for step in start_step..=age_ticks {
                if step % 32 == 0 {
                    control.check()?;
                }
                cache.steps += 1;
                for modifier in &pipeline.modifiers {
                    match modifier {
                        NodeKind::Gravity { acceleration } => {
                            velocity[0] += acceleration[0] * dt;
                            velocity[1] += acceleration[1] * dt;
                        }
                        NodeKind::Drag { coefficient } => {
                            let decay = 1.0 / (1.0 + coefficient * dt);
                            velocity[0] *= decay;
                            velocity[1] *= decay;
                        }
                        NodeKind::Attractor {
                            center,
                            strength,
                            softening,
                        } => {
                            let delta = [center[0] - position[0], center[1] - position[1]];
                            let distance = delta[0].hypot(delta[1]);
                            if distance > 1e-9 {
                                let force = strength / (1.0 + distance / softening).powi(2);
                                velocity[0] += delta[0] / distance * force * dt;
                                velocity[1] += delta[1] / distance * force * dt;
                            }
                        }
                        NodeKind::Vortex {
                            center,
                            strength,
                            inward,
                            radius,
                        } => {
                            let delta = [position[0] - center[0], position[1] - center[1]];
                            let distance = delta[0].hypot(delta[1]);
                            if distance > 1e-9 {
                                let falloff = (1.0 - distance / radius).max(0.0);
                                velocity[0] += (-delta[1] * strength - delta[0] * inward)
                                    / distance
                                    * falloff
                                    * dt;
                                velocity[1] += (delta[0] * strength - delta[1] * inward) / distance
                                    * falloff
                                    * dt;
                            }
                        }
                        NodeKind::Turbulence {
                            strength,
                            frequency,
                            scroll,
                        } => {
                            let (x, y) = noise_field.as_ref().expect("compiled noise field");
                            let time = f64::from(birth_tick + step) * dt;
                            let point = [
                                position[0] * frequency + scroll[0] * time,
                                position[1] * frequency + scroll[1] * time,
                            ];
                            velocity[0] += x.get(point) * strength * dt;
                            velocity[1] += y.get(point) * strength * dt;
                        }
                        _ => {}
                    }
                }
                position[0] += velocity[0] * dt;
                position[1] += velocity[1] * dt;
                if trail_config.is_some() {
                    history.push_back((step, position));
                    while history
                        .front()
                        .is_some_and(|(tick, _)| *tick < step.saturating_sub(history_ticks))
                    {
                        history.pop_front();
                    }
                }
            }
            let trail = if let Some((ticks, max_points, _)) = trail_config {
                let start = age_ticks.saturating_sub(ticks);
                let stride = ticks.div_ceil(max_points - 1).max(1);
                history
                    .iter()
                    .filter(|(tick, _)| {
                        *tick >= start && ((*tick - start) % stride == 0 || *tick == age_ticks)
                    })
                    .map(|(_, p)| *p)
                    .collect()
            } else {
                vec![]
            };
            cache.particles.insert(
                key,
                Kinematics {
                    tick: age_ticks,
                    position,
                    velocity,
                    history,
                },
            );
            let fraction = (age / life).clamp(0.0, 1.0);
            let mut color = [1.0; 4];
            let mut radius = 1.0;
            for modifier in &pipeline.modifiers {
                match modifier {
                    NodeKind::ColorOverLife { start, end } => {
                        for c in 0..4 {
                            color[c] = (f64::from(start[c])
                                + (f64::from(end[c]) - f64::from(start[c])) * fraction)
                                / 255.0;
                        }
                    }
                    NodeKind::SizeOverLife { start, end } => {
                        radius = start + (end - start) * fraction
                    }
                    NodeKind::SizeCurve { curve } => radius = curve.sample(fraction),
                    NodeKind::OpacityCurve { curve } => color[3] *= curve.sample(fraction),
                    NodeKind::ColorGradient { gradient } => color = gradient.sample(fraction),
                    _ => {}
                }
            }
            if let Some((_, _, _, taper)) = sweep
                && taper > 0.0
            {
                radius *= (4.0 * along * (1.0 - along)).powf(taper);
            }
            let appearance = material.map(|m| {
                let mut rotation =
                    random.sample(m.rotation_degrees) + random.sample(m.angular_velocity) * age;
                for modifier in &pipeline.modifiers {
                    if let NodeKind::RotationCurve { curve } = modifier {
                        rotation += curve.sample(fraction);
                    }
                }
                if m.align_velocity {
                    rotation += velocity[1].atan2(velocity[0]).to_degrees();
                }
                let mut scale = m.scale;
                scale[0] *= (1.0 + velocity[0].hypot(velocity[1]) * m.velocity_stretch).min(16.0);
                let frame = m.sprite.as_ref().map_or(0, |sprite| {
                    let n = graph.assets[&sprite.asset].frames;
                    let initial = if sprite.random_start {
                        (random.unit() * f64::from(n)).floor() as u32
                    } else {
                        sprite.start_frame
                    };
                    match sprite.playback {
                        FlipbookPlayback::Lifetime => {
                            initial
                                + ((fraction * f64::from(n - initial)).floor() as u32)
                                    .min(n - initial - 1)
                        }
                        FlipbookPlayback::Once => {
                            (initial + (age * sprite.fps).floor() as u32).min(n - 1)
                        }
                        FlipbookPlayback::Loop => (initial + (age * sprite.fps).floor() as u32) % n,
                        FlipbookPlayback::PingPong => {
                            if n == 1 {
                                0
                            } else {
                                let period = 2 * (n - 1);
                                let step = (initial + (age * sprite.fps).floor() as u32) % period;
                                if step < n { step } else { period - step }
                            }
                        }
                    }
                });
                Appearance {
                    layer: m.layer,
                    blend: m.blend,
                    shape: m.shape,
                    sprite: m.sprite.as_ref().map(|s| s.asset.clone()),
                    frame,
                    rotation: rotation.to_radians(),
                    scale,
                }
            });
            particles.push(Particle {
                appearance,
                position,
                radius,
                color,
                trail,
                trail_width: trail_config.map_or(0.0, |(_, _, scale)| radius * scale),
            });
        }
    }
    particles.sort_by_key(|p| p.appearance.as_ref().map_or(0, |a| a.layer));
    Ok(particles)
}
