use vfx_core::*;

pub fn scene(emitter: NodeKind, modifiers: Vec<NodeKind>) -> Scene {
    let mut nodes = vec![Node {
        id: "emitter".into(),
        kind: emitter,
    }];
    for (i, kind) in modifiers.into_iter().enumerate() {
        nodes.push(Node {
            id: format!("modifier_{i}"),
            kind,
        });
    }
    nodes.push(Node {
        id: "render".into(),
        kind: NodeKind::Renderer {
            blend: Blend::Normal,
            shape: Shape::Circle,
        },
    });
    let edges = nodes
        .windows(2)
        .map(|p| Edge {
            from: p[0].id.clone(),
            to: p[1].id.clone(),
        })
        .collect();
    Scene {
        assets: Default::default(),
        post_process: vec![],
        name: "Feature fixture".into(),
        canvas: Canvas {
            width: 64,
            height: 64,
            pixel_mode: true,
        },
        simulation: Simulation {
            seed: 42,
            tick_hz: 60,
            duration_seconds: 1.0,
        },
        nodes,
        edges,
        output_node: "render".into(),
    }
}

pub fn stationary(position: [f64; 2], count: u32) -> NodeKind {
    NodeKind::EmitterShape {
        count,
        shape: SpawnShape::Point { position },
        start_seconds: 0.0,
        travel_seconds: 0.0,
        lifetime: [2.0, 2.0],
        speed: [0.0, 0.0],
        angle_degrees: [0.0, 0.0],
    }
}
