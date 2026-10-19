use crate::animation::{Curve, Gradient};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const BACKEND: &str = "cpu-reference-v1";
pub const MAX_PARTICLES: u32 = 4096;
pub const MAX_NODES: usize = 64;
pub const MAX_HISTORY: usize = 16;
pub const MAX_RENDER_WORK: u64 = 50_000_000;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Canvas {
    pub width: u32,
    pub height: u32,
    pub pixel_mode: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Simulation {
    pub seed: u64,
    pub tick_hz: u32,
    pub duration_seconds: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Blend {
    Normal,
    Additive,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Shape {
    Circle,
    Quad,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum SpawnShape {
    Point {
        position: [f64; 2],
    },
    Circle {
        center: [f64; 2],
        radius: f64,
        edge: bool,
    },
    Box {
        min: [f64; 2],
        max: [f64; 2],
    },
    Line {
        start: [f64; 2],
        end: [f64; 2],
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Glow {
    pub radius: u32,
    pub strength: f64,
    pub threshold: f64,
    pub tint: [u8; 3],
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum NodeKind {
    EmitterBurst {
        count: u32,
        lifetime: [f64; 2],
        speed: [f64; 2],
        angle_degrees: [f64; 2],
        origin: [f64; 2],
    },
    EmitterStream {
        rate: f64,
        lifetime: [f64; 2],
        speed: [f64; 2],
        angle_degrees: [f64; 2],
        origin: [f64; 2],
    },
    /// Sweep particle births along a timed polyline, for slashes and drawn trails.
    EmitterPath {
        count: u32,
        points: Vec<[f64; 2]>,
        start_seconds: f64,
        travel_seconds: f64,
        lifetime: [f64; 2],
        speed: [f64; 2],
        angle_degrees: [f64; 2],
        /// 0 keeps constant width; positive values taper both ends.
        taper: f64,
    },
    EmitterShape {
        count: u32,
        shape: SpawnShape,
        start_seconds: f64,
        travel_seconds: f64,
        lifetime: [f64; 2],
        speed: [f64; 2],
        angle_degrees: [f64; 2],
    },
    Gravity {
        acceleration: [f64; 2],
    },
    Drag {
        coefficient: f64,
    },
    ColorOverLife {
        start: [u8; 4],
        end: [u8; 4],
    },
    SizeOverLife {
        start: f64,
        end: f64,
    },
    SizeCurve {
        curve: Curve,
    },
    OpacityCurve {
        curve: Curve,
    },
    ColorGradient {
        gradient: Gradient,
    },
    Vortex {
        center: [f64; 2],
        strength: f64,
        inward: f64,
        radius: f64,
    },
    Attractor {
        center: [f64; 2],
        strength: f64,
        softening: f64,
    },
    Turbulence {
        strength: f64,
        frequency: f64,
        scroll: [f64; 2],
    },
    Trail {
        seconds: f64,
        max_points: u32,
        width_scale: f64,
    },
    RendererGlow {
        blend: Blend,
        shape: Shape,
        glow: Glow,
    },
    Renderer {
        blend: Blend,
        shape: Shape,
    },
}

impl NodeKind {
    pub fn is_emitter(&self) -> bool {
        matches!(
            self,
            Self::EmitterBurst { .. }
                | Self::EmitterStream { .. }
                | Self::EmitterPath { .. }
                | Self::EmitterShape { .. }
        )
    }
    pub fn is_renderer(&self) -> bool {
        matches!(self, Self::Renderer { .. } | Self::RendererGlow { .. })
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Node {
    pub id: String,
    pub kind: NodeKind,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Edge {
    pub from: String,
    pub to: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Scene {
    pub name: String,
    pub canvas: Canvas,
    pub simulation: Simulation,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub output_node: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Project {
    pub format: String,
    pub schema_version: u32,
    pub engine_version: String,
    pub revision: u64,
    pub scene: Scene,
    pub undo: Vec<Scene>,
    pub redo: Vec<Scene>,
}

impl Project {
    pub fn new(scene: Scene) -> Self {
        Self {
            format: "vfxmaker.project".into(),
            schema_version: 1,
            engine_version: ENGINE_VERSION.into(),
            revision: 0,
            scene,
            undo: vec![],
            redo: vec![],
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum Operation {
    SetName { name: String },
    SetCanvas { canvas: Canvas },
    SetSimulation { simulation: Simulation },
    AddNode { node: Node },
    ReplaceNode { node: Node },
    RemoveNode { node_id: String },
    Connect { edge: Edge },
    Disconnect { edge: Edge },
    SetOutput { node_id: String },
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    Sequence,
    Spritesheet,
    Gif,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(default, deny_unknown_fields)]
pub struct GifSettings {
    pub scale: u32,
    pub background: [u8; 3],
    pub repeat: bool,
    pub quantizer_speed: u8,
}
impl Default for GifSettings {
    fn default() -> Self {
        Self {
            scale: 1,
            background: [0, 0, 0],
            repeat: true,
            quantizer_speed: 10,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ExportRequest {
    pub project: String,
    /// New directory to create; existing targets are never overwritten.
    pub out: String,
    pub format: ExportFormat,
    pub fps: u32,
    #[serde(default)]
    pub gif: Option<GifSettings>,
}
