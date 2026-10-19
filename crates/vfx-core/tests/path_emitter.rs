use vfx_core::{
    Blend, Canvas, Edge, Node, NodeKind, Scene, Shape, Simulation, export, graph, simulation,
};

fn scene() -> Scene {
    Scene {
        name: "Timed stroke".into(),
        canvas: Canvas {
            width: 64,
            height: 64,
            pixel_mode: true,
        },
        simulation: Simulation {
            seed: 42,
            tick_hz: 120,
            duration_seconds: 1.0,
        },
        nodes: vec![
            Node {
                id: "path".into(),
                kind: NodeKind::EmitterPath {
                    count: 5,
                    points: vec![[0.0, 0.0], [20.0, 0.0], [20.0, 20.0]],
                    start_seconds: 0.1,
                    travel_seconds: 0.2,
                    lifetime: [0.5, 0.5],
                    speed: [0.0, 0.0],
                    angle_degrees: [0.0, 0.0],
                    taper: 1.0,
                },
            },
            Node {
                id: "width".into(),
                kind: NodeKind::SizeOverLife {
                    start: 4.0,
                    end: 4.0,
                },
            },
            Node {
                id: "render".into(),
                kind: NodeKind::Renderer {
                    blend: Blend::Normal,
                    shape: Shape::Circle,
                },
            },
        ],
        edges: vec![
            Edge {
                from: "path".into(),
                to: "width".into(),
            },
            Edge {
                from: "width".into(),
                to: "render".into(),
            },
        ],
        output_node: "render".into(),
    }
}

#[test]
fn timed_path_samples_equal_arc_lengths_and_tapers_without_changing_replay() {
    let s = scene();
    let graph = graph::compile(&s).unwrap();
    assert!(simulation::snapshot(&s, &graph, 0.099).unwrap().is_empty());
    let middle = simulation::snapshot(&s, &graph, 0.2).unwrap();
    assert_eq!(middle.len(), 3);
    assert_eq!(middle[0].position, [0.0, 0.0]);
    assert_eq!(middle[1].position, [10.0, 0.0]);
    assert_eq!(middle[2].position, [20.0, 0.0]);
    assert_eq!(middle[0].radius, 0.0);
    assert_eq!(middle[1].radius, 3.0);
    assert_eq!(middle[2].radius, 4.0);
    let end = simulation::snapshot(&s, &graph, 0.3).unwrap();
    assert_eq!(end.len(), 5);
    assert_eq!(end[4].position, [20.0, 20.0]);
    assert_eq!(end[4].radius, 0.0);
    assert_eq!(middle, simulation::snapshot(&s, &graph, 0.2).unwrap());
    assert!(simulation::snapshot(&s, &graph, 0.9).unwrap().is_empty());
}

#[test]
fn path_geometry_timing_and_work_limits_are_validated() {
    let base = scene();
    for (points, start, travel, count, taper) in [
        (vec![], 0.1, 0.2, 5, 0.0),
        (vec![[1.0, 1.0], [1.0, 1.0]], 0.1, 0.2, 5, 0.0),
        (vec![[1.0, 1.0], [2.0, 2.0]], -0.1, 0.2, 5, 0.0),
        (vec![[1.0, 1.0], [2.0, 2.0]], 0.9, 0.2, 5, 0.0),
        (vec![[1.0, 1.0], [2.0, 2.0]], 0.1, 0.2, 4097, 0.0),
        (vec![[1.0, 1.0], [2.0, 2.0]], 0.1, 0.2, 5, f64::NAN),
    ] {
        let mut s = base.clone();
        s.nodes[0].kind = NodeKind::EmitterPath {
            count,
            points,
            start_seconds: start,
            travel_seconds: travel,
            lifetime: [0.5, 0.5],
            speed: [0.0, 0.0],
            angle_degrees: [0.0, 0.0],
            taper,
        };
        assert!(graph::compile(&s).is_err());
    }
    let mut heavy = base;
    if let NodeKind::EmitterPath { count, .. } = &mut heavy.nodes[0].kind {
        *count = 4096;
    }
    assert_eq!(
        export::check_budget(&heavy, &graph::compile(&heavy).unwrap(), 300)
            .unwrap_err()
            .code,
        "LIMIT_EXCEEDED"
    );
}
