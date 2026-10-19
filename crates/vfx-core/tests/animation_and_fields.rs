mod common;
use common::{scene, stationary};
use vfx_core::{animation::*, graph, render, simulation, *};

fn curve(mode: Interpolation) -> Curve {
    Curve {
        keys: vec![
            Keyframe {
                time: 0.0,
                value: 0.0,
                interpolation: mode,
            },
            Keyframe {
                time: 1.0,
                value: 1.0,
                interpolation: mode,
            },
        ],
    }
}

#[test]
fn curve_interpolation_has_defined_boundaries_and_key_steps() {
    let linear = curve(Interpolation::Linear);
    linear.validate(0.0, 1.0).unwrap();
    assert_eq!(linear.sample(-1.0), 0.0);
    assert_eq!(linear.sample(0.25), 0.25);
    assert_eq!(linear.sample(2.0), 1.0);
    assert_eq!(curve(Interpolation::Smooth).sample(0.25), 0.15625);
    let hold = curve(Interpolation::Hold);
    assert_eq!(hold.sample(0.999), 0.0);
    assert_eq!(hold.sample(1.0), 1.0);
    let keys = Curve {
        keys: vec![
            Keyframe {
                time: 0.0,
                value: 0.0,
                interpolation: Interpolation::Hold,
            },
            Keyframe {
                time: 0.5,
                value: 1.0,
                interpolation: Interpolation::Linear,
            },
            Keyframe {
                time: 1.0,
                value: 0.0,
                interpolation: Interpolation::Linear,
            },
        ],
    };
    assert_eq!(keys.sample(0.49), 0.0);
    assert_eq!(keys.sample(0.5), 1.0);
    assert_eq!(keys.sample(0.75), 0.5);
}

#[test]
fn malformed_animation_data_is_rejected_before_sampling() {
    for keys in [
        vec![],
        vec![Keyframe {
            time: 0.0,
            value: 0.0,
            interpolation: Interpolation::Linear,
        }],
        vec![
            Keyframe {
                time: 0.5,
                value: 0.0,
                interpolation: Interpolation::Linear,
            },
            Keyframe {
                time: 1.0,
                value: 0.0,
                interpolation: Interpolation::Linear,
            },
        ],
    ] {
        assert!(Curve { keys }.validate(0.0, 1.0).is_err());
    }
    let mut nan = curve(Interpolation::Linear);
    nan.keys[0].value = f64::NAN;
    assert!(nan.validate(0.0, 1.0).is_err());
    let mut duplicate = curve(Interpolation::Linear);
    duplicate.keys.insert(1, duplicate.keys[0].clone());
    assert!(duplicate.validate(0.0, 1.0).is_err());
    assert!(curve(Interpolation::Linear).validate(0.0, 0.5).is_err());
}

#[test]
fn color_gradient_interpolates_rgba_and_respects_hold_keys() {
    let gradient = Gradient {
        stops: vec![
            ColorStop {
                time: 0.0,
                color: [255, 0, 0, 255],
                interpolation: Interpolation::Linear,
            },
            ColorStop {
                time: 1.0,
                color: [0, 0, 255, 0],
                interpolation: Interpolation::Linear,
            },
        ],
    };
    gradient.validate().unwrap();
    assert_eq!(gradient.sample(0.5), [0.5, 0.0, 0.5, 0.5]);
    let mut hold = gradient.clone();
    hold.stops[0].interpolation = Interpolation::Hold;
    assert_eq!(hold.sample(0.8), [1.0, 0.0, 0.0, 1.0]);
    assert_eq!(hold.sample(1.0), [0.0, 0.0, 1.0, 0.0]);
    let mut s = scene(
        stationary([32.0, 32.0], 1),
        vec![
            NodeKind::ColorGradient { gradient },
            NodeKind::OpacityCurve {
                curve: curve(Interpolation::Linear),
            },
        ],
    );
    s.simulation.duration_seconds = 2.0;
    let p = simulation::snapshot(&s, &graph::compile(&s).unwrap(), 1.0).unwrap();
    assert_eq!(p[0].color, [0.5, 0.0, 0.5, 0.25]);
}

#[test]
fn circle_emission_uses_uniform_area_and_ring_emission_uses_the_perimeter() {
    for edge in [false, true] {
        let mut source = stationary([32.0, 32.0], 1024);
        if let NodeKind::EmitterShape { shape, .. } = &mut source {
            *shape = SpawnShape::Circle {
                center: [32.0, 32.0],
                radius: 10.0,
                edge,
            };
        }
        let s = scene(source, vec![]);
        let particles = simulation::snapshot(&s, &graph::compile(&s).unwrap(), 0.0).unwrap();
        assert_eq!(particles.len(), 1024);
        let r2: Vec<_> = particles
            .iter()
            .map(|p| (p.position[0] - 32.0).powi(2) + (p.position[1] - 32.0).powi(2))
            .collect();
        assert!(r2.iter().all(|r| *r <= 100.0000001));
        if edge {
            assert!(r2.iter().all(|r| (r - 100.0).abs() < 1e-8));
        } else {
            let mean = r2.iter().sum::<f64>() / r2.len() as f64;
            assert!((44.0..56.0).contains(&mean), "area-uniform mean r²={mean}");
        }
    }
}

#[test]
fn box_line_and_scheduled_shape_births_stay_in_their_domains() {
    for shape in [
        SpawnShape::Box {
            min: [10.0, 20.0],
            max: [18.0, 24.0],
        },
        SpawnShape::Line {
            start: [10.0, 20.0],
            end: [18.0, 24.0],
        },
    ] {
        let mut source = stationary([0.0, 0.0], 100);
        if let NodeKind::EmitterShape {
            shape: s,
            start_seconds,
            travel_seconds,
            ..
        } = &mut source
        {
            *s = shape.clone();
            *start_seconds = 0.1;
            *travel_seconds = 0.2;
        }
        let s = scene(source, vec![]);
        let graph = graph::compile(&s).unwrap();
        assert!(simulation::snapshot(&s, &graph, 0.05).unwrap().is_empty());
        let p = simulation::snapshot(&s, &graph, 0.3).unwrap();
        assert_eq!(p.len(), 100);
        for p in p {
            assert!((10.0..=18.0).contains(&p.position[0]));
            assert!((20.0..=24.0).contains(&p.position[1]));
            if matches!(shape, SpawnShape::Line { .. }) {
                assert!(((p.position[0] - 10.0) * 0.5 - (p.position[1] - 20.0)).abs() < 1e-9);
            }
        }
    }
}

#[test]
fn softened_attraction_repulsion_and_vortex_forces_have_expected_directions() {
    for strength in [120.0, -120.0] {
        let s = scene(
            stationary([16.0, 32.0], 1),
            vec![NodeKind::Attractor {
                center: [48.0, 32.0],
                strength,
                softening: 64.0,
            }],
        );
        let p = simulation::snapshot(&s, &graph::compile(&s).unwrap(), 0.2).unwrap();
        assert!((p[0].position[0] - 16.0) * strength > 0.0);
        assert_eq!(p[0].position[1], 32.0);
    }
    let s = scene(
        stationary([48.0, 32.0], 1),
        vec![NodeKind::Vortex {
            center: [32.0, 32.0],
            strength: 100.0,
            inward: 0.0,
            radius: 100.0,
        }],
    );
    let p = simulation::snapshot(&s, &graph::compile(&s).unwrap(), 0.2).unwrap();
    assert!(p[0].position[1] > 32.0);
    let centered = scene(
        stationary([32.0, 32.0], 1),
        vec![NodeKind::Attractor {
            center: [32.0, 32.0],
            strength: 120.0,
            softening: 1.0,
        }],
    );
    assert_eq!(
        simulation::snapshot(&centered, &graph::compile(&centered).unwrap(), 0.2).unwrap()[0]
            .position,
        [32.0, 32.0]
    );
}

#[test]
fn noise_fields_are_seeded_repeatable_and_change_when_the_seed_changes() {
    let mut s = scene(
        stationary([31.0, 29.0], 4),
        vec![NodeKind::Turbulence {
            strength: 50.0,
            frequency: 0.075,
            scroll: [0.1, 0.2],
        }],
    );
    let a = simulation::snapshot(&s, &graph::compile(&s).unwrap(), 0.4).unwrap();
    assert!(a.iter().all(|p| p.position.iter().all(|v| v.is_finite())));
    assert_ne!(a[0].position, [31.0, 29.0]);
    assert_eq!(
        a,
        simulation::snapshot(&s, &graph::compile(&s).unwrap(), 0.4).unwrap()
    );
    s.simulation.seed += 1;
    assert_ne!(
        a,
        simulation::snapshot(&s, &graph::compile(&s).unwrap(), 0.4).unwrap()
    );
}

#[test]
fn trail_history_is_bounded_replayable_and_renders_behind_the_particle() {
    let source = NodeKind::EmitterBurst {
        count: 1,
        lifetime: [2.0, 2.0],
        speed: [40.0, 40.0],
        angle_degrees: [0.0, 0.0],
        origin: [16.0, 32.0],
    };
    let normal = scene(source.clone(), vec![]);
    let s = scene(
        source,
        vec![NodeKind::Trail {
            seconds: 0.2,
            max_points: 8,
            width_scale: 1.0,
        }],
    );
    let graph = graph::compile(&s).unwrap();
    let p = simulation::snapshot(&s, &graph, 0.5).unwrap();
    assert!(p[0].trail.len() <= 8 && p[0].trail.len() >= 2);
    assert_eq!(*p[0].trail.last().unwrap(), p[0].position);
    assert!(p[0].trail[0][0] > 16.0);
    assert_eq!(p, simulation::snapshot(&s, &graph, 0.5).unwrap());
    let trail = render::frame(&s, &graph, 0.5).unwrap();
    let plain = render::frame(&normal, &vfx_core::graph::compile(&normal).unwrap(), 0.5).unwrap();
    assert!(trail.stats.nontransparent_pixels > plain.stats.nontransparent_pixels);
    assert!(trail.rgba[((32 * 64 + 30) * 4) + 3] > 0);
    assert_eq!(plain.rgba[((32 * 64 + 30) * 4) + 3], 0);
}

#[test]
fn glow_expands_visible_coverage_and_keeps_straight_alpha_png_pixels_valid() {
    let plain = scene(
        stationary([32.0, 32.0], 1),
        vec![
            NodeKind::SizeOverLife {
                start: 2.0,
                end: 2.0,
            },
            NodeKind::ColorOverLife {
                start: [255, 30, 20, 200],
                end: [255, 30, 20, 200],
            },
        ],
    );
    let mut s = plain.clone();
    s.nodes.last_mut().unwrap().kind = NodeKind::RendererGlow {
        blend: Blend::Normal,
        shape: Shape::Circle,
        glow: Glow {
            radius: 3,
            strength: 2.0,
            threshold: 0.2,
            tint: [255, 255, 255],
        },
    };
    let frame = render::frame(&s, &graph::compile(&s).unwrap(), 0.2).unwrap();
    let base = render::frame(&plain, &graph::compile(&plain).unwrap(), 0.2).unwrap();
    assert!(frame.stats.nontransparent_pixels > base.stats.nontransparent_pixels);
    assert!(
        frame
            .rgba
            .as_chunks::<4>()
            .0
            .iter()
            .all(|p| p[3] != 0 || p[..3] == [0, 0, 0])
    );
    assert_eq!(frame.rgba[3], 0);
    assert!(
        frame
            .rgba
            .as_chunks::<4>()
            .0
            .iter()
            .any(|p| p[3] > 0 && p[3] < 100)
    );
}

#[test]
fn unsafe_modifier_ranges_and_duplicate_trails_are_rejected() {
    for modifier in [
        NodeKind::Trail {
            seconds: 0.2,
            max_points: 33,
            width_scale: 1.0,
        },
        NodeKind::Turbulence {
            strength: 1.0,
            frequency: 0.0,
            scroll: [0.0, 0.0],
        },
        NodeKind::Attractor {
            center: [0.0, 0.0],
            strength: 1.0,
            softening: 0.0,
        },
    ] {
        assert!(graph::compile(&scene(stationary([32.0, 32.0], 1), vec![modifier])).is_err());
    }
    let trail = NodeKind::Trail {
        seconds: 0.2,
        max_points: 8,
        width_scale: 1.0,
    };
    assert!(
        graph::compile(&scene(
            stationary([32.0, 32.0], 1),
            vec![trail.clone(), trail]
        ))
        .is_err()
    );
}
