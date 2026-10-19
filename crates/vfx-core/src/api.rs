pub use crate::storage::Workspace;
use crate::{Error, Result, export, graph, model::*};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

fn width() -> u32 {
    crate::recipe::library().default_canvas.width
}
fn height() -> u32 {
    crate::recipe::library().default_canvas.height
}
fn seed() -> u64 {
    42
}
fn yes() -> bool {
    true
}
fn preset() -> String {
    crate::recipe::library().default_preset.clone()
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct NewProject {
    /// Project JSON path relative to the configured root, or an absolute path within it.
    pub path: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default = "preset")]
    pub preset: String,
    #[serde(default = "width")]
    pub width: u32,
    #[serde(default = "height")]
    pub height: u32,
    #[serde(default = "seed")]
    pub seed: u64,
    #[serde(default = "yes")]
    pub pixel_mode: bool,
    #[serde(default)]
    pub preset_file: Option<String>,
    #[serde(default)]
    pub params: std::collections::BTreeMap<String, Value>,
    #[serde(default)]
    pub duration_seconds: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ProjectPath {
    pub project: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct VersionRequest {
    pub project: String,
    pub expected_revision: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Patch {
    pub project: String,
    pub expected_revision: u64,
    pub operations: Vec<Operation>,
    #[serde(default)]
    pub dry_run: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PreviewRequest {
    pub project: String,
    pub times: Vec<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SchemaRequest {
    pub kind: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PresetRequest {
    pub id: String,
}

pub fn capabilities() -> Value {
    json!({"engine_version":ENGINE_VERSION,"project_schema_version":1,"backend":BACKEND,"headless":true,"offline":true,"interfaces":["cli","mcp-stdio"],"export_formats":["sequence","spritesheet","gif"],"preview":"PNG frame or montage, up to 8 times","mutations":{"atomic":true,"expected_revision":true,"dry_run":true,"undo_redo":true,"history_limit":MAX_HISTORY},"limits":{"canvas_side":1024,"particle_births":MAX_PARTICLES,"nodes":MAX_NODES,"duration_seconds":10,"export_frames":300,"export_pixels":32*1024*1024,"render_work_units":50_000_000},"platform":{"os":std::env::consts::OS,"arch":std::env::consts::ARCH},"gui":false,"gpu":false})
}

pub fn presets() -> Value {
    crate::recipe::catalog()
}

pub fn catalog() -> Value {
    json!({"port_type":"ParticleStream","emitters":["emitter_burst","emitter_stream","emitter_path","emitter_shape"],"modifiers":["gravity","drag","color_over_life","size_over_life","size_curve","opacity_curve","color_gradient","vortex","attractor","turbulence","trail"],"output":["renderer","renderer_glow"],"units":{"time":"seconds","position":"pixels from top-left","velocity":"pixels/second","angle":"degrees, positive clockwise","size":"radius in pixels","color":"sRGB RGBA bytes"},"node_schema":schemars::schema_for!(Node)})
}

pub fn schema(kind: &str) -> Result<Value> {
    Ok(match kind {
        "project" => serde_json::to_value(schemars::schema_for!(Project))?,
        "patch" => serde_json::to_value(schemars::schema_for!(Patch))?,
        "node" => serde_json::to_value(schemars::schema_for!(Node))?,
        "recipe" => serde_json::to_value(schemars::schema_for!(crate::recipe::Recipe))?,
        _ => {
            return Err(Error::new(
                "INVALID_ARGUMENT",
                "Schema kind must be project, patch, node, or recipe",
            ));
        }
    })
}

fn preset_scene(request: &NewProject, workspace: &Workspace) -> Result<Scene> {
    if let Some(path) = &request.preset_file {
        let recipe: crate::recipe::Recipe = serde_json::from_slice(&workspace.read_bytes(path)?)?;
        crate::recipe::instantiate(&recipe, request)
    } else {
        crate::recipe::instantiate(crate::recipe::builtin(&request.preset)?, request)
    }
}

pub fn summary(project: &Project) -> Value {
    json!({"format":project.format,"schema_version":project.schema_version,"engine_version":project.engine_version,"revision":project.revision,"scene":project.scene,"undo_depth":project.undo.len(),"redo_depth":project.redo.len()})
}

fn revision(project: &Project, expected: u64) -> Result<()> {
    if project.revision != expected {
        return Err(Error::new(
            "REVISION_CONFLICT",
            format!(
                "Expected revision {expected}, current revision is {}; inspect and retry",
                project.revision
            ),
        ));
    }
    Ok(())
}

impl Workspace {
    pub fn new_project(&self, request: NewProject) -> Result<Value> {
        let path = self.resolve(&request.path)?;
        let _lock = self.lock(&path)?;
        if path.exists() {
            return Err(Error::new(
                "ALREADY_EXISTS",
                "Project exists; choose a new project path",
            ));
        }
        let project = Project::new(preset_scene(&request, self)?);
        self.write_project(&path, &project, true)?;
        Ok(summary(&project))
    }
    pub fn inspect(&self, path: &str) -> Result<Value> {
        Ok(summary(&self.read_project(path)?))
    }
    pub fn validate(&self, path: &str) -> Result<Value> {
        let p = self.read_project(path)?;
        Ok(
            json!({"valid":true,"revision":p.revision,"nodes":p.scene.nodes.len(),"backend":BACKEND}),
        )
    }
    pub fn patch(&self, request: Patch) -> Result<Value> {
        if request.operations.is_empty() || request.operations.len() > 128 {
            return Err(Error::new(
                "INVALID_ARGUMENT",
                "A patch must contain 1..=128 operations",
            ));
        }
        let path = self.resolve(&request.project)?;
        let _lock = self.lock(&path)?;
        let mut project = self.read_project(&path)?;
        revision(&project, request.expected_revision)?;
        let mut candidate = project.scene.clone();
        for op in request.operations {
            match op {
                Operation::SetName { name } => candidate.name = name,
                Operation::SetCanvas { canvas } => candidate.canvas = canvas,
                Operation::SetSimulation { simulation } => candidate.simulation = simulation,
                Operation::SetOutput { node_id } => candidate.output_node = node_id,
                Operation::AddNode { node } => {
                    if candidate.nodes.iter().any(|n| n.id == node.id) {
                        return Err(Error::invalid("Node already exists"));
                    }
                    candidate.nodes.push(node);
                }
                Operation::ReplaceNode { node } => {
                    let old = candidate
                        .nodes
                        .iter_mut()
                        .find(|n| n.id == node.id)
                        .ok_or_else(|| Error::invalid("Cannot replace missing node"))?;
                    *old = node;
                }
                Operation::RemoveNode { node_id } => {
                    let old = candidate.nodes.len();
                    candidate.nodes.retain(|n| n.id != node_id);
                    if old == candidate.nodes.len() {
                        return Err(Error::invalid("Cannot remove missing node"));
                    }
                    candidate
                        .edges
                        .retain(|e| e.from != node_id && e.to != node_id);
                }
                Operation::Connect { edge } => candidate.edges.push(edge),
                Operation::Disconnect { edge } => {
                    let old = candidate.edges.len();
                    candidate.edges.retain(|e| *e != edge);
                    if old == candidate.edges.len() {
                        return Err(Error::invalid("Cannot disconnect missing edge"));
                    }
                }
            }
        }
        graph::compile(&candidate)?;
        if candidate == project.scene {
            return Err(Error::new("NO_CHANGE", "Patch does not change the project"));
        }
        if request.dry_run {
            let mut result = summary(&project);
            result["dry_run"] = json!(true);
            result["proposed_scene"] = json!(candidate);
            return Ok(result);
        }
        project.undo.push(project.scene.clone());
        if project.undo.len() > MAX_HISTORY {
            project.undo.remove(0);
        }
        project.redo.clear();
        project.scene = candidate;
        project.engine_version = ENGINE_VERSION.into();
        project.revision = project
            .revision
            .checked_add(1)
            .ok_or_else(|| Error::invalid("Revision exhausted"))?;
        self.write_project(&path, &project, false)?;
        Ok(summary(&project))
    }
    pub fn history(&self, path: &str, expected: u64, redo: bool) -> Result<Value> {
        let path = self.resolve(path)?;
        let _lock = self.lock(&path)?;
        let mut p = self.read_project(&path)?;
        revision(&p, expected)?;
        let prior = if redo { p.redo.pop() } else { p.undo.pop() }
            .ok_or_else(|| Error::new("EMPTY_HISTORY", "No history in that direction"))?;
        if redo {
            p.undo.push(p.scene.clone());
        } else {
            p.redo.push(p.scene.clone());
        }
        p.scene = prior;
        p.engine_version = ENGINE_VERSION.into();
        p.revision = p
            .revision
            .checked_add(1)
            .ok_or_else(|| Error::invalid("Revision exhausted"))?;
        self.write_project(&path, &p, false)?;
        Ok(summary(&p))
    }
    pub fn preview(&self, request: PreviewRequest) -> Result<export::Preview> {
        export::preview(&self.read_project(request.project)?, &request.times)
    }
    pub fn export(&self, request: ExportRequest) -> Result<Value> {
        let p = self.read_project(&request.project)?;
        export::export(self, &p, &request)
    }
}
