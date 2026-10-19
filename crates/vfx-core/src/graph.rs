use crate::{Error, Result, model::*};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug)]
pub struct Pipeline {
    pub emitter: Node,
    pub modifiers: Vec<NodeKind>,
}

#[derive(Clone, Debug)]
pub struct Compiled {
    pub pipelines: Vec<Pipeline>,
    pub blend: Blend,
    pub shape: Shape,
    pub glow: Option<Glow>,
    pub assets: BTreeMap<String, crate::assets::DecodedAsset>,
}

fn bounded(value: f64, min: f64, max: f64, label: &str) -> Result<()> {
    if !value.is_finite() || !(min..=max).contains(&value) {
        return Err(Error::invalid(format!(
            "{label} must be finite and within {min}..={max}"
        )));
    }
    Ok(())
}
fn range(value: [f64; 2], min: f64, max: f64, label: &str) -> Result<()> {
    bounded(value[0], min, max, label)?;
    bounded(value[1], value[0], max, label)
}

pub fn validate_project(project: &Project) -> Result<()> {
    if project.format != "vfxmaker.project"
        || project.schema_version != 1
        || !["0.1.0", "0.2.0", ENGINE_VERSION].contains(&project.engine_version.as_str())
    {
        return Err(Error::new(
            "UNSUPPORTED_VERSION",
            "Expected vfxmaker.project schema 1 from engine 0.1.0, 0.2.0 or the current engine",
        ));
    }
    if project.undo.len() > MAX_HISTORY || project.redo.len() > MAX_HISTORY {
        return Err(Error::invalid("History exceeds 16 snapshots"));
    }
    compile(&project.scene)?;
    for scene in project.undo.iter().chain(&project.redo) {
        compile(scene)?;
    }
    Ok(())
}

pub fn compile(scene: &Scene) -> Result<Compiled> {
    if scene.assets.len() > 16 {
        return Err(Error::new("LIMIT_EXCEEDED", "At most 16 embedded assets"));
    }
    let mut assets = BTreeMap::new();
    let mut asset_pixels = 0;
    for (id, asset) in &scene.assets {
        if id.is_empty()
            || id.len() > 64
            || !id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        {
            return Err(Error::invalid(
                "Asset IDs require 1..64 ASCII letters/digits/underscores/hyphens",
            ));
        }
        let decoded = asset.decode()?;
        asset_pixels += u64::from(decoded.width) * u64::from(decoded.height);
        if asset_pixels > crate::assets::MAX_TOTAL_ASSET_PIXELS {
            return Err(Error::new(
                "LIMIT_EXCEEDED",
                "Total embedded assets exceed 1 Mi pixels",
            ));
        }
        assets.insert(id.clone(), decoded);
    }
    crate::post::validate(&scene.post_process, &assets)?;
    if scene.name.trim().is_empty() || scene.name.len() > 256 {
        return Err(Error::invalid("Name must contain 1..=256 bytes"));
    }
    if scene.canvas.width == 0
        || scene.canvas.height == 0
        || scene.canvas.width > 1024
        || scene.canvas.height > 1024
    {
        return Err(Error::invalid("Canvas dimensions must be 1..=1024"));
    }
    if ![30, 60, 120, 240].contains(&scene.simulation.tick_hz) {
        return Err(Error::invalid("tick_hz must be 30, 60, 120, or 240"));
    }
    bounded(
        scene.simulation.duration_seconds,
        0.01,
        10.0,
        "duration_seconds",
    )?;
    if scene.nodes.is_empty() || scene.nodes.len() > MAX_NODES || scene.edges.len() > MAX_NODES * 4
    {
        return Err(Error::invalid(
            "Graph must contain 1..=64 nodes and at most 256 edges",
        ));
    }
    let mut nodes = BTreeMap::new();
    let mut spawns: u64 = 0;
    for node in &scene.nodes {
        if node.id.is_empty()
            || node.id.len() > 64
            || !node
                .id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        {
            return Err(Error::invalid(
                "Node IDs must be 1..=64 ASCII letters, digits, underscores or hyphens",
            ));
        }
        if nodes.insert(node.id.as_str(), node).is_some() {
            return Err(Error::invalid(format!("Duplicate node ID {}", node.id)));
        }
        let (lifetime, speed, angle, origin) = match &node.kind {
            NodeKind::EmitterBurst {
                count,
                lifetime,
                speed,
                angle_degrees,
                origin,
            } => {
                if *count == 0 {
                    return Err(Error::invalid("Burst count must be positive"));
                }
                spawns += u64::from(*count);
                (lifetime, speed, angle_degrees, origin)
            }
            NodeKind::EmitterStream {
                rate,
                lifetime,
                speed,
                angle_degrees,
                origin,
            } => {
                bounded(*rate, 0.1, 1000.0, "rate")?;
                spawns += (*rate * scene.simulation.duration_seconds).ceil() as u64;
                (lifetime, speed, angle_degrees, origin)
            }
            NodeKind::EmitterPath {
                count,
                points,
                start_seconds,
                travel_seconds,
                lifetime,
                speed,
                angle_degrees,
                taper,
            } => {
                if *count < 2 || points.len() < 2 || points.len() > 64 {
                    return Err(Error::invalid(
                        "Path emission requires at least 2 particles and 2..=64 points",
                    ));
                }
                bounded(
                    *start_seconds,
                    0.0,
                    scene.simulation.duration_seconds,
                    "start_seconds",
                )?;
                bounded(
                    *travel_seconds,
                    0.0,
                    scene.simulation.duration_seconds,
                    "travel_seconds",
                )?;
                bounded(*taper, 0.0, 4.0, "taper")?;
                if *start_seconds >= scene.simulation.duration_seconds
                    || start_seconds + travel_seconds > scene.simulation.duration_seconds + 1e-9
                {
                    return Err(Error::invalid(
                        "Path emission must start before and finish within the project duration",
                    ));
                }
                for point in points {
                    for value in point {
                        bounded(*value, -1024.0, 2048.0, "path point")?;
                    }
                }
                if points
                    .windows(2)
                    .any(|p| (p[1][0] - p[0][0]).hypot(p[1][1] - p[0][1]) < 1e-9)
                {
                    return Err(Error::invalid("Consecutive path points must be distinct"));
                }
                spawns += u64::from(*count);
                (lifetime, speed, angle_degrees, &points[0])
            }
            NodeKind::EmitterShape {
                count,
                shape,
                start_seconds,
                travel_seconds,
                lifetime,
                speed,
                angle_degrees,
            } => {
                if *count == 0 {
                    return Err(Error::invalid("Shape emission count must be positive"));
                }
                bounded(
                    *start_seconds,
                    0.0,
                    scene.simulation.duration_seconds,
                    "start_seconds",
                )?;
                bounded(
                    *travel_seconds,
                    0.0,
                    scene.simulation.duration_seconds,
                    "travel_seconds",
                )?;
                if *start_seconds >= scene.simulation.duration_seconds
                    || start_seconds + travel_seconds > scene.simulation.duration_seconds + 1e-9
                {
                    return Err(Error::invalid(
                        "Shape emission must start before and finish within the project duration",
                    ));
                }
                let origin = match shape {
                    SpawnShape::Point { position } => position,
                    SpawnShape::Circle { center, radius, .. } => {
                        bounded(*radius, 0.0, 1024.0, "spawn radius")?;
                        center
                    }
                    SpawnShape::Box { min, max } => {
                        for i in 0..2 {
                            bounded(max[i], min[i], 2048.0, "spawn box maximum")?;
                        }
                        min
                    }
                    SpawnShape::Line { start, end } => {
                        for x in end {
                            bounded(*x, -1024.0, 2048.0, "line end")?;
                        }
                        start
                    }
                };
                spawns += u64::from(*count);
                (lifetime, speed, angle_degrees, origin)
            }
            NodeKind::Material { settings } => {
                if !(-1024..=1024).contains(&settings.layer) {
                    return Err(Error::invalid("Layer must be -1024..1024"));
                }
                range(
                    settings.rotation_degrees,
                    -36000.0,
                    36000.0,
                    "rotation_degrees",
                )?;
                range(
                    settings.angular_velocity,
                    -36000.0,
                    36000.0,
                    "angular_velocity",
                )?;
                for scale in settings.scale {
                    bounded(scale, 0.05, 16.0, "material scale")?;
                }
                bounded(settings.velocity_stretch, 0.0, 1.0, "velocity_stretch")?;
                if let Some(sprite) = &settings.sprite {
                    let image = assets
                        .get(&sprite.asset)
                        .ok_or_else(|| Error::invalid("Sprite refers to a missing asset"))?;
                    if sprite.start_frame >= image.frames {
                        return Err(Error::invalid("Sprite start_frame is outside asset frames"));
                    }
                    bounded(sprite.fps, 0.1, 120.0, "sprite fps")?;
                }
                continue;
            }
            NodeKind::Timeline { settings } => {
                bounded(
                    settings.delay_seconds,
                    0.0,
                    scene.simulation.duration_seconds,
                    "timeline delay",
                )?;
                bounded(
                    settings.duration_seconds,
                    1.0 / f64::from(scene.simulation.tick_hz),
                    scene.simulation.duration_seconds,
                    "timeline duration",
                )?;
                let ticks = settings.duration_seconds * f64::from(scene.simulation.tick_hz);
                if (ticks - ticks.round()).abs() > 1e-6 {
                    return Err(Error::invalid(
                        "Timeline duration must be a whole number of simulation ticks",
                    ));
                }
                if settings.delay_seconds >= scene.simulation.duration_seconds
                    || (!settings.repeat
                        && settings.delay_seconds + settings.duration_seconds
                            > scene.simulation.duration_seconds + 1e-9)
                {
                    return Err(Error::invalid("Timeline active window must fit the scene"));
                }
                continue;
            }
            NodeKind::RotationCurve { curve } => {
                curve.validate(-36000.0, 36000.0)?;
                continue;
            }
            NodeKind::SizeCurve { curve } => {
                curve.validate(0.0, 32.0)?;
                continue;
            }
            NodeKind::OpacityCurve { curve } => {
                curve.validate(0.0, 1.0)?;
                continue;
            }
            NodeKind::ColorGradient { gradient } => {
                gradient.validate()?;
                continue;
            }
            NodeKind::Vortex {
                center,
                strength,
                inward,
                radius,
            } => {
                for x in center {
                    bounded(*x, -1024.0, 2048.0, "vortex center")?;
                }
                bounded(*strength, -2000.0, 2000.0, "vortex strength")?;
                bounded(*inward, -2000.0, 2000.0, "vortex inward")?;
                bounded(*radius, 0.01, 2048.0, "vortex radius")?;
                continue;
            }
            NodeKind::Attractor {
                center,
                strength,
                softening,
            } => {
                for x in center {
                    bounded(*x, -1024.0, 2048.0, "attractor center")?;
                }
                bounded(*strength, -2000.0, 2000.0, "attractor strength")?;
                bounded(*softening, 0.01, 2048.0, "attractor softening")?;
                continue;
            }
            NodeKind::Turbulence {
                strength,
                frequency,
                scroll,
            } => {
                bounded(*strength, 0.0, 2000.0, "turbulence strength")?;
                bounded(*frequency, 0.001, 2.0, "turbulence frequency")?;
                for x in scroll {
                    bounded(*x, -100.0, 100.0, "turbulence scroll")?;
                }
                continue;
            }
            NodeKind::Trail {
                seconds,
                max_points,
                width_scale,
            } => {
                bounded(*seconds, 0.01, 2.0, "trail seconds")?;
                bounded(*width_scale, 0.01, 4.0, "trail width_scale")?;
                if !(2..=32).contains(max_points) {
                    return Err(Error::invalid("Trail max_points must be 2..=32"));
                }
                continue;
            }
            NodeKind::RendererGlow { glow, .. } => {
                if !(1..=32).contains(&glow.radius) {
                    return Err(Error::invalid("Glow radius must be 1..=32"));
                }
                bounded(glow.strength, 0.0, 8.0, "glow strength")?;
                bounded(glow.threshold, 0.0, 0.99, "glow threshold")?;
                continue;
            }
            NodeKind::Gravity { acceleration } => {
                for x in acceleration {
                    bounded(*x, -2000.0, 2000.0, "acceleration")?;
                }
                continue;
            }
            NodeKind::Drag { coefficient } => {
                bounded(*coefficient, 0.0, 100.0, "drag")?;
                continue;
            }
            NodeKind::SizeOverLife { start, end } => {
                bounded(*start, 0.0, 32.0, "size")?;
                bounded(*end, 0.0, 32.0, "size")?;
                continue;
            }
            _ => continue,
        };
        range(*lifetime, 0.01, 10.0, "lifetime")?;
        range(*speed, 0.0, 2000.0, "speed")?;
        range(*angle, -3600.0, 3600.0, "angle_degrees")?;
        for x in origin {
            bounded(*x, -1024.0, 2048.0, "origin")?;
        }
    }
    if spawns > u64::from(MAX_PARTICLES) {
        return Err(Error::new(
            "LIMIT_EXCEEDED",
            "Total particle births must be at most 4096 per effect",
        ));
    }
    let mut incoming: BTreeMap<&str, Vec<&str>> = nodes.keys().map(|id| (*id, vec![])).collect();
    let mut unique = BTreeSet::new();
    for edge in &scene.edges {
        let from = nodes
            .get(edge.from.as_str())
            .ok_or_else(|| Error::invalid(format!("Missing source {}", edge.from)))?;
        let to = nodes
            .get(edge.to.as_str())
            .ok_or_else(|| Error::invalid(format!("Missing destination {}", edge.to)))?;
        if from.kind.is_renderer() || to.kind.is_emitter() {
            return Err(Error::new(
                "INVALID_PORT_TYPE",
                "Emitters produce ParticleStream; modifiers transform it; renderer is a terminal output",
            ));
        }
        if !unique.insert((&edge.from, &edge.to)) {
            return Err(Error::invalid("Duplicate edge"));
        }
        incoming
            .get_mut(edge.to.as_str())
            .unwrap()
            .push(edge.from.as_str());
    }
    // Check every node, including disconnected cycles, before collecting paths.
    fn visit<'a>(
        id: &'a str,
        incoming: &BTreeMap<&'a str, Vec<&'a str>>,
        active: &mut BTreeSet<&'a str>,
        done: &mut BTreeSet<&'a str>,
    ) -> Result<()> {
        if done.contains(id) {
            return Ok(());
        }
        if !active.insert(id) {
            return Err(Error::new("GRAPH_CYCLE", format!("Cycle at node {id}")));
        }
        for parent in &incoming[id] {
            visit(parent, incoming, active, done)?;
        }
        active.remove(id);
        done.insert(id);
        Ok(())
    }
    let mut done = BTreeSet::new();
    for id in nodes.keys() {
        visit(id, &incoming, &mut BTreeSet::new(), &mut done)?;
    }
    let out = nodes
        .get(scene.output_node.as_str())
        .ok_or_else(|| Error::invalid("Missing output_node"))?;
    let (blend, shape, glow) = match &out.kind {
        NodeKind::Renderer { blend, shape } => (*blend, *shape, None),
        NodeKind::RendererGlow { blend, shape, glow } => (*blend, *shape, Some(glow.clone())),
        _ => return Err(Error::invalid("output_node must be a renderer")),
    };
    for (id, node) in &nodes {
        let n = incoming[id].len();
        if (node.kind.is_emitter() && n != 0)
            || (node.kind.is_renderer() && (n == 0 || *id != scene.output_node))
            || (!node.kind.is_emitter() && !node.kind.is_renderer() && n != 1)
        {
            return Err(Error::invalid(format!(
                "Invalid input count or unused renderer at {id}"
            )));
        }
    }
    let mut pipelines = vec![];
    let mut used = BTreeSet::from([scene.output_node.as_str()]);
    for parent in &incoming[scene.output_node.as_str()] {
        let mut id = *parent;
        let mut modifiers = vec![];
        loop {
            used.insert(id);
            let node = nodes[id];
            if node.kind.is_emitter() {
                modifiers.reverse();
                pipelines.push(Pipeline {
                    emitter: node.clone(),
                    modifiers,
                });
                break;
            }
            modifiers.push(node.kind.clone());
            id = incoming[id][0];
        }
    }
    if used.len() != nodes.len() {
        return Err(Error::invalid(
            "All nodes must contribute to the output renderer",
        ));
    }
    // A shared emitter branching to multiple render inputs would double-count it.
    let mut sources = BTreeSet::new();
    if pipelines.iter().any(|p| !sources.insert(&p.emitter.id)) {
        return Err(Error::invalid(
            "Each emitter must have exactly one path to the output",
        ));
    }
    // Stable IDs define draw order independently of JSON array or edge order.
    pipelines.sort_by(|a, b| a.emitter.id.cmp(&b.emitter.id));
    if pipelines.iter().any(|p| {
        p.modifiers
            .iter()
            .filter(|m| matches!(m, NodeKind::Trail { .. }))
            .count()
            > 1
    }) {
        return Err(Error::invalid(
            "A particle pipeline may contain only one trail modifier",
        ));
    }
    for pipeline in &pipelines {
        for duplicate in ["material", "timeline"] {
            let count = pipeline
                .modifiers
                .iter()
                .filter(|m| {
                    matches!(
                        (duplicate, m),
                        ("material", NodeKind::Material { .. })
                            | ("timeline", NodeKind::Timeline { .. })
                    )
                })
                .count();
            if count > 1 {
                return Err(Error::invalid(
                    "Only one material and one timeline are allowed per pipeline",
                ));
            }
        }
        if let Some(t) = pipeline.modifiers.iter().find_map(|m| {
            if let NodeKind::Timeline { settings } = m {
                Some(settings)
            } else {
                None
            }
        }) {
            let (lifetime, finish) = match &pipeline.emitter.kind {
                NodeKind::EmitterBurst { lifetime, .. }
                | NodeKind::EmitterStream { lifetime, .. } => (*lifetime, 0.0),
                NodeKind::EmitterPath {
                    lifetime,
                    start_seconds,
                    travel_seconds,
                    ..
                }
                | NodeKind::EmitterShape {
                    lifetime,
                    start_seconds,
                    travel_seconds,
                    ..
                } => (*lifetime, start_seconds + travel_seconds),
                _ => unreachable!("validated emitter"),
            };
            if finish > t.duration_seconds + 1e-9 {
                return Err(Error::invalid(
                    "Emitter schedule exceeds its timeline duration",
                ));
            }
            if t.repeat && lifetime[1] > t.duration_seconds + 1e-9 {
                return Err(Error::invalid(
                    "Repeating timelines require particle lifetimes no longer than the cycle",
                ));
            }
        }
    }
    Ok(Compiled {
        pipelines,
        blend,
        shape,
        glow,
        assets,
    })
}
