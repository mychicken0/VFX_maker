use crate::animation::{Curve, Gradient};
use crate::assets::ImageAsset;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

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
    Screen,
    Multiply,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Shape {
    Circle,
    Quad,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum FlipbookPlayback {
    Lifetime,
    Once,
    Loop,
    PingPong,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, deny_unknown_fields)]
pub struct Sprite {
    pub asset: String,
    pub playback: FlipbookPlayback,
    pub fps: f64,
    pub start_frame: u32,
    pub random_start: bool,
}
impl Default for Sprite {
    fn default() -> Self {
        Self {
            asset: String::new(),
            playback: FlipbookPlayback::Lifetime,
            fps: 12.0,
            start_frame: 0,
            random_start: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, deny_unknown_fields)]
pub struct Material {
    pub layer: i32,
    pub blend: Option<Blend>,
    pub shape: Option<Shape>,
    pub sprite: Option<Sprite>,
    pub rotation_degrees: [f64; 2],
    pub angular_velocity: [f64; 2],
    pub align_velocity: bool,
    pub scale: [f64; 2],
    /// Extra horizontal scale per pixel/second of speed, capped at 16x.
    pub velocity_stretch: f64,
}
impl Default for Material {
    fn default() -> Self {
        Self {
            layer: 0,
            blend: None,
            shape: None,
            sprite: None,
            rotation_degrees: [0.0; 2],
            angular_velocity: [0.0; 2],
            align_velocity: false,
            scale: [1.0; 2],
            velocity_stretch: 0.0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default, deny_unknown_fields)]
pub struct Timeline {
    pub delay_seconds: f64,
    pub duration_seconds: f64,
    pub repeat: bool,
}
impl Default for Timeline {
    fn default() -> Self {
        Self {
            delay_seconds: 0.0,
            duration_seconds: 1.0,
            repeat: false,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum MaskChannel {
    Alpha,
    Luminance,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum PostProcess {
    Palette {
        colors: Vec<[u8; 3]>,
        dither: f64,
        alpha_levels: u32,
    },
    Mask {
        asset: String,
        frame: u32,
        channel: MaskChannel,
        invert: bool,
    },
    WaveDistortion {
        amount: [f64; 2],
        frequency: [f64; 2],
        period_seconds: f64,
    },
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
    Material {
        settings: Material,
    },
    Timeline {
        settings: Timeline,
    },
    RotationCurve {
        curve: Curve,
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
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub assets: BTreeMap<String, ImageAsset>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub post_process: Vec<PostProcess>,
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
    UpsertAsset { id: String, asset: ImageAsset },
    RemoveAsset { id: String },
    SetPostProcess { effects: Vec<PostProcess> },
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
    Godot,
    Unity,
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
