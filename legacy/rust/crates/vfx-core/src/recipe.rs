//! Data-only effect recipes. Rendering and simulation never branch on preset IDs.
use crate::{Error, Result, api::NewProject, graph, model::*};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::LazyLock};

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ParameterKind {
    Number { min: f64, max: f64 },
    Integer { min: u32, max: u32 },
    Vec2 { min: f64, max: f64 },
    Range { min: f64, max: f64 },
    Color,
}

impl ParameterKind {
    pub fn check(&self, value: &Value) -> Result<()> {
        let valid = match self {
            Self::Number { min, max } => {
                min.is_finite()
                    && max.is_finite()
                    && min <= max
                    && value
                        .as_f64()
                        .is_some_and(|v| v.is_finite() && (*min..=*max).contains(&v))
            }
            Self::Integer { min, max } => {
                min <= max
                    && value
                        .as_u64()
                        .is_some_and(|v| (u64::from(*min)..=u64::from(*max)).contains(&v))
            }
            Self::Vec2 { min, max } | Self::Range { min, max } => {
                min.is_finite()
                    && max.is_finite()
                    && min <= max
                    && value.as_array().is_some_and(|a| {
                        a.len() == 2
                            && a.iter().all(|v| {
                                v.as_f64()
                                    .is_some_and(|x| x.is_finite() && (*min..=*max).contains(&x))
                            })
                            && (!matches!(self, Self::Range { .. })
                                || a[0].as_f64() <= a[1].as_f64())
                    })
            }
            Self::Color => value.as_array().is_some_and(|a| {
                a.len() == 4 && a.iter().all(|v| v.as_u64().is_some_and(|n| n <= 255))
            }),
        };
        if !valid {
            return Err(Error::new(
                "INVALID_PARAMETER",
                "Recipe parameter has an invalid type, range, or shape",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Binding {
    pub node_id: String,
    pub property: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Parameter {
    pub kind: ParameterKind,
    pub description: String,
    pub targets: Vec<Binding>,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Recipe {
    pub format: String,
    pub schema_version: u32,
    pub id: String,
    pub description: String,
    pub scene: Scene,
    pub parameters: BTreeMap<String, Parameter>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Library {
    pub format: String,
    pub schema_version: u32,
    pub default_preset: String,
    pub default_canvas: Canvas,
    pub presets: Vec<Recipe>,
}

static LIBRARY: LazyLock<Library> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../presets/library.json"))
        .expect("embedded recipe library is validated by integration tests")
});
pub fn library() -> &'static Library {
    &LIBRARY
}

pub fn builtin(id: &str) -> Result<&'static Recipe> {
    library()
        .presets
        .iter()
        .find(|p| p.id == id)
        .ok_or_else(|| {
            Error::new(
                "UNKNOWN_PRESET",
                format!("Unknown preset {id}; inspect preset list for available recipes"),
            )
        })
}

fn target(scene: &Scene, binding: &Binding) -> Result<Value> {
    if !binding.property.starts_with('/') || binding.property == "/type" {
        return Err(Error::new(
            "INVALID_RECIPE",
            "Parameter bindings must address an existing node property",
        ));
    }
    let node = scene
        .nodes
        .iter()
        .find(|n| n.id == binding.node_id)
        .ok_or_else(|| Error::new("INVALID_RECIPE", "Parameter refers to a missing node"))?;
    serde_json::to_value(&node.kind)?
        .pointer(&binding.property)
        .cloned()
        .ok_or_else(|| Error::new("INVALID_RECIPE", "Parameter refers to a missing property"))
}

pub fn validate(recipe: &Recipe) -> Result<()> {
    if recipe.format != "vfxmaker.recipe"
        || recipe.schema_version != 1
        || recipe.id.is_empty()
        || recipe.id.len() > 64
        || !recipe
            .id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        || recipe.description.len() > 2048
        || recipe.parameters.len() > 32
    {
        return Err(Error::new(
            "INVALID_RECIPE",
            "Invalid recipe header, ID, or parameter count",
        ));
    }
    graph::compile(&recipe.scene)?;
    for (name, param) in &recipe.parameters {
        if name.is_empty()
            || name.len() > 64
            || !name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
            || param.targets.is_empty()
            || param.targets.len() > 16
            || param.description.len() > 1024
        {
            return Err(Error::new(
                "INVALID_RECIPE",
                "Invalid parameter name, description or bindings",
            ));
        }
        for binding in &param.targets {
            param.kind.check(&target(&recipe.scene, binding)?)?;
        }
    }
    Ok(())
}

pub fn defaults(recipe: &Recipe) -> Result<BTreeMap<String, Value>> {
    validate(recipe)?;
    recipe
        .parameters
        .iter()
        .map(|(name, param)| Ok((name.clone(), target(&recipe.scene, &param.targets[0])?)))
        .collect()
}

pub fn catalog() -> Value {
    json!(library().presets.iter().map(|r|json!({"id":r.id,"description":r.description,"canvas":r.scene.canvas,"duration_seconds":r.scene.simulation.duration_seconds,"parameters":r.parameters,"parameter_defaults":defaults(r).expect("validated embedded bindings")})).collect::<Vec<_>>())
}

pub fn inspect(id: &str) -> Result<Value> {
    let r = builtin(id)?;
    validate(r)?;
    Ok(json!({"recipe":r,"parameter_defaults":defaults(r)?}))
}

pub fn instantiate(recipe: &Recipe, request: &NewProject) -> Result<Scene> {
    validate(recipe)?;
    if request.width == 0 || request.height == 0 || request.width > 1024 || request.height > 1024 {
        return Err(Error::invalid("Canvas dimensions must be 1..=1024"));
    }
    let mut scene = recipe.scene.clone();
    let sx = f64::from(request.width) / f64::from(scene.canvas.width);
    let sy = f64::from(request.height) / f64::from(scene.canvas.height);
    let scale = sx.min(sy);
    let position = |v: &mut [f64; 2]| {
        v[0] *= sx;
        v[1] *= sy;
    };
    let range = |v: &mut [f64; 2]| {
        v[0] *= scale;
        v[1] *= scale;
    };
    for node in &mut scene.nodes {
        match &mut node.kind {
            NodeKind::EmitterBurst { origin, speed, .. }
            | NodeKind::EmitterStream { origin, speed, .. } => {
                position(origin);
                range(speed);
            }
            NodeKind::EmitterPath { points, speed, .. } => {
                for p in points {
                    position(p);
                }
                range(speed);
            }
            NodeKind::EmitterShape { shape, speed, .. } => {
                range(speed);
                match shape {
                    SpawnShape::Point { position: p } => position(p),
                    SpawnShape::Circle { center, radius, .. } => {
                        position(center);
                        *radius *= scale;
                    }
                    SpawnShape::Box { min, max } => {
                        position(min);
                        position(max);
                    }
                    SpawnShape::Line { start, end } => {
                        position(start);
                        position(end);
                    }
                }
            }
            NodeKind::Gravity { acceleration } => position(acceleration),
            NodeKind::SizeOverLife { start, end } => {
                *start *= scale;
                *end *= scale;
            }
            NodeKind::SizeCurve { curve } => {
                for key in &mut curve.keys {
                    key.value *= scale;
                }
            }
            NodeKind::Vortex {
                center,
                strength,
                inward,
                radius,
            } => {
                position(center);
                *strength *= scale;
                *inward *= scale;
                *radius *= scale;
            }
            NodeKind::Attractor {
                center,
                strength,
                softening,
            } => {
                position(center);
                *strength *= scale;
                *softening *= scale;
            }
            NodeKind::Turbulence {
                strength,
                frequency,
                ..
            } => {
                *strength *= scale;
                *frequency /= scale;
            }
            NodeKind::RendererGlow { glow, .. } => {
                glow.radius = (f64::from(glow.radius) * scale).round().max(1.0) as u32
            }
            _ => {}
        }
    }
    scene.canvas = Canvas {
        width: request.width,
        height: request.height,
        pixel_mode: request.pixel_mode,
    };
    scene.simulation.seed = request.seed;
    if let Some(duration) = request.duration_seconds {
        scene.simulation.duration_seconds = duration;
    }
    if let Some(name) = &request.name {
        scene.name = name.clone();
    }
    if request.params.len() > 32 {
        return Err(Error::new(
            "LIMIT_EXCEEDED",
            "At most 32 recipe parameters can be supplied",
        ));
    }
    for (name, value) in &request.params {
        let spec = recipe.parameters.get(name).ok_or_else(|| {
            Error::new(
                "UNKNOWN_PARAMETER",
                format!("Unknown parameter {name}; inspect this recipe's declared parameters"),
            )
        })?;
        spec.kind.check(value)?;
        for binding in &spec.targets {
            let node = scene
                .nodes
                .iter_mut()
                .find(|n| n.id == binding.node_id)
                .ok_or_else(|| Error::new("INVALID_RECIPE", "Missing binding node"))?;
            let mut kind = serde_json::to_value(&node.kind)?;
            *kind
                .pointer_mut(&binding.property)
                .ok_or_else(|| Error::new("INVALID_RECIPE", "Missing binding property"))? =
                value.clone();
            node.kind = serde_json::from_value(kind)?;
        }
    }
    graph::compile(&scene)?;
    Ok(scene)
}
