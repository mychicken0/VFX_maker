use clap::{Parser, Subcommand, ValueEnum};
use serde_json::{Value, json};
use std::{path::PathBuf, process::ExitCode};
use vfx_core::{error::success, *};

#[derive(Parser)]
#[command(
    name = "vfx",
    version,
    about = "Create, edit and export deterministic 2D VFX from any project directory"
)]
struct Cli {
    /// Existing directory that contains every input and output. Defaults to the current directory.
    #[arg(long, global = true, default_value = ".")]
    root: PathBuf,
    /// Emit compact machine-readable JSON (default output is pretty JSON).
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Report the engine's actual supported features and limits.
    Doctor,
    /// Insert or update an emitter's material without manually rewiring nodes.
    Material {
        project: String,
        #[arg(long)]
        emitter: String,
        #[arg(long)]
        settings: String,
        #[arg(long)]
        expected_revision: u64,
        #[arg(long)]
        dry_run: bool,
    },
    /// Insert or update an emitter's local timeline without manual graph edits.
    Timeline {
        project: String,
        #[arg(long)]
        emitter: String,
        #[arg(long)]
        settings: String,
        #[arg(long)]
        expected_revision: u64,
        #[arg(long)]
        dry_run: bool,
    },
    /// Import or inspect embedded PNG sprites and flipbooks.
    Asset {
        #[command(subcommand)]
        command: AssetCommand,
    },
    /// Save an existing project as a portable reusable recipe.
    Recipe {
        #[command(subcommand)]
        command: RecipeCommand,
    },
    /// Measure rendering, clipping, empty samples and incremental simulation work.
    Analyze {
        project: String,
        #[arg(long, default_value_t = 12)]
        samples: u32,
        #[arg(long)]
        compare_fresh: bool,
    },
    /// List bundled editable effect recipes.
    Preset {
        #[command(subcommand)]
        command: PresetCommand,
    },
    /// List available node types, ports and their schema.
    Node {
        #[command(subcommand)]
        command: ListCommand,
    },
    /// Print a JSON Schema: project, patch, node, recipe, asset, post_process or export.
    Schema { kind: String },
    /// Create a project without overwriting an existing file.
    New {
        path: String,
        #[arg(long, default_value_t = default_preset(),conflicts_with="preset_file")]
        preset: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long, default_value_t = default_canvas())]
        canvas: String,
        #[arg(long, default_value_t = 42)]
        seed: u64,
        /// Use antialiased shapes rather than snapped pixel rendering.
        #[arg(long)]
        smooth: bool,
        /// Load a data-only recipe file within --root instead of a bundled preset.
        #[arg(long)]
        preset_file: Option<String>,
        /// JSON object containing this recipe's declared parameter overrides.
        #[arg(long, default_value = "{}")]
        params: String,
        #[arg(long)]
        duration: Option<f64>,
    },
    /// Inspect the editable scene and current revision.
    Inspect { project: String },
    /// Validate schema, graph, parameter ranges and budgets.
    Validate { project: String },
    /// Apply an atomic JSON array of typed operations.
    Patch {
        project: String,
        #[arg(long)]
        expected_revision: u64,
        #[arg(
            long,
            conflicts_with = "ops_file",
            required_unless_present = "ops_file"
        )]
        ops: Option<String>,
        #[arg(long, conflicts_with = "ops")]
        ops_file: Option<String>,
        #[arg(long)]
        dry_run: bool,
    },
    Undo {
        project: String,
        #[arg(long)]
        expected_revision: u64,
    },
    Redo {
        project: String,
        #[arg(long)]
        expected_revision: u64,
    },
    /// Render a transparent PNG frame or montage; existing files are protected.
    Preview {
        project: String,
        #[arg(
            long,
            value_delimiter = ',',
            num_args = 1,
            default_value = "0.05,0.15,0.3,0.5"
        )]
        times: Vec<f64>,
        #[arg(long)]
        out: String,
    },
    /// Export into a new directory containing images and metadata.json.
    Export {
        project: String,
        #[arg(long, value_enum, default_value = "spritesheet")]
        format: Format,
        #[arg(long, default_value_t = 20)]
        fps: u32,
        #[arg(long)]
        out: String,
        /// GIF only: integer nearest-neighbor display scale.
        #[arg(long)]
        scale: Option<u32>,
        /// GIF only: matte background as #RRGGBB.
        #[arg(long)]
        background: Option<String>,
        /// GIF only: play once instead of repeating.
        #[arg(long)]
        no_loop: bool,
        /// GIF only: palette quantizer speed (1 highest quality, 30 fastest).
        #[arg(long)]
        quantizer_speed: Option<u8>,
        /// Emit progress events on stderr while keeping stdout JSON clean.
        #[arg(long)]
        progress: bool,
    },
}
#[derive(Subcommand)]
enum AssetCommand {
    List {
        project: String,
    },
    Import {
        project: String,
        #[arg(long)]
        file: String,
        #[arg(long)]
        id: String,
        #[arg(long)]
        expected_revision: u64,
        #[arg(long, default_value_t = 1)]
        columns: u32,
        #[arg(long, default_value_t = 1)]
        rows: u32,
        #[arg(long)]
        frames: Option<u32>,
        #[arg(long)]
        dry_run: bool,
    },
}
#[derive(Subcommand)]
enum RecipeCommand {
    Save {
        project: String,
        #[arg(long)]
        out: String,
        #[arg(long)]
        id: String,
        #[arg(long)]
        description: String,
    },
}
#[derive(Subcommand)]
enum PresetCommand {
    List,
    /// Inspect a data recipe or save a customizable copy without overwriting.
    Show {
        id: String,
        #[arg(long)]
        out: Option<String>,
    },
}
#[derive(Subcommand)]
enum ListCommand {
    List,
}
#[derive(Clone, ValueEnum)]
enum Format {
    Sequence,
    Spritesheet,
    Gif,
    Godot,
    Unity,
}

fn default_preset() -> String {
    vfx_core::recipe::library().default_preset.clone()
}
fn default_canvas() -> String {
    let c = &vfx_core::recipe::library().default_canvas;
    format!("{}x{}", c.width, c.height)
}
fn rgb(value: &str) -> Result<[u8; 3]> {
    let value = value.strip_prefix('#').unwrap_or(value);
    if value.len() != 6 || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(Error::new("INVALID_ARGUMENT", "Background must be #RRGGBB"));
    }
    Ok([
        u8::from_str_radix(&value[..2], 16).unwrap(),
        u8::from_str_radix(&value[2..4], 16).unwrap(),
        u8::from_str_radix(&value[4..], 16).unwrap(),
    ])
}

fn run(cli: &Cli) -> Result<Value> {
    let workspace = Workspace::new(&cli.root)?;
    match &cli.command {
        Command::Doctor => {
            let mut info = capabilities();
            info["root"] = json!(workspace.root());
            Ok(info)
        }
        Command::Material {
            project,
            emitter,
            settings,
            expected_revision,
            dry_run,
        } => workspace.set_material(api::MaterialRequest {
            project: project.clone(),
            emitter: emitter.clone(),
            settings: serde_json::from_str(settings)?,
            expected_revision: *expected_revision,
            dry_run: *dry_run,
        }),
        Command::Timeline {
            project,
            emitter,
            settings,
            expected_revision,
            dry_run,
        } => workspace.set_timeline(api::TimelineRequest {
            project: project.clone(),
            emitter: emitter.clone(),
            settings: serde_json::from_str(settings)?,
            expected_revision: *expected_revision,
            dry_run: *dry_run,
        }),
        Command::Asset {
            command: AssetCommand::List { project },
        } => workspace.list_assets(project),
        Command::Asset {
            command:
                AssetCommand::Import {
                    project,
                    file,
                    id,
                    expected_revision,
                    columns,
                    rows,
                    frames,
                    dry_run,
                },
        } => workspace.import_asset(api::ImportAsset {
            project: project.clone(),
            file: file.clone(),
            id: id.clone(),
            expected_revision: *expected_revision,
            columns: *columns,
            rows: *rows,
            frames: *frames,
            dry_run: *dry_run,
        }),
        Command::Recipe {
            command:
                RecipeCommand::Save {
                    project,
                    out,
                    id,
                    description,
                },
        } => workspace.save_recipe(api::SaveRecipe {
            project: project.clone(),
            out: out.clone(),
            id: id.clone(),
            description: description.clone(),
        }),
        Command::Analyze {
            project,
            samples,
            compare_fresh,
        } => workspace.analyze(analysis::AnalyzeRequest {
            project: project.clone(),
            samples: *samples,
            compare_fresh: *compare_fresh,
        }),
        Command::Preset {
            command: PresetCommand::List,
        } => Ok(presets()),
        Command::Preset {
            command: PresetCommand::Show { id, out },
        } => {
            if let Some(out) = out {
                let r = vfx_core::recipe::builtin(id)?;
                vfx_core::recipe::validate(r)?;
                let path = workspace.resolve(out)?;
                storage::atomic_write(&path, &serde_json::to_vec_pretty(r)?, false)?;
                Ok(json!({"id":id,"out":path}))
            } else {
                vfx_core::recipe::inspect(id)
            }
        }
        Command::Node { .. } => Ok(catalog()),
        Command::Schema { kind } => schema(kind),
        Command::New {
            path,
            preset,
            name,
            canvas,
            seed,
            smooth,
            preset_file,
            params,
            duration,
        } => {
            let (w, h) = canvas
                .split_once('x')
                .ok_or_else(|| Error::new("INVALID_ARGUMENT", "Canvas must be WIDTHxHEIGHT"))?;
            let width = w
                .parse()
                .map_err(|_| Error::new("INVALID_ARGUMENT", "Invalid canvas width"))?;
            let height = h
                .parse()
                .map_err(|_| Error::new("INVALID_ARGUMENT", "Invalid canvas height"))?;
            workspace.new_project(NewProject {
                path: path.clone(),
                name: name.clone(),
                preset: preset.clone(),
                width,
                height,
                seed: *seed,
                pixel_mode: !*smooth,
                preset_file: preset_file.clone(),
                params: serde_json::from_str(params)?,
                duration_seconds: *duration,
            })
        }
        Command::Inspect { project } => workspace.inspect(project),
        Command::Validate { project } => workspace.validate(project),
        Command::Patch {
            project,
            expected_revision,
            ops,
            ops_file,
            dry_run,
        } => {
            let bytes = if let Some(ops) = ops {
                ops.as_bytes().to_vec()
            } else {
                workspace.read_bytes(ops_file.as_ref().unwrap())?
            };
            let operations = serde_json::from_slice(&bytes)?;
            workspace.patch(Patch {
                project: project.clone(),
                expected_revision: *expected_revision,
                operations,
                dry_run: *dry_run,
            })
        }
        Command::Undo {
            project,
            expected_revision,
        } => workspace.history(project, *expected_revision, false),
        Command::Redo {
            project,
            expected_revision,
        } => workspace.history(project, *expected_revision, true),
        Command::Preview {
            project,
            times,
            out,
        } => {
            let target = workspace.resolve(out)?;
            let preview = workspace.preview(PreviewRequest {
                project: project.clone(),
                times: times.clone(),
            })?;
            storage::atomic_write(&target, &preview.png, false)?;
            let mut metadata = preview.metadata();
            metadata["out"] = json!(target);
            Ok(metadata)
        }
        Command::Export {
            project,
            format,
            fps,
            out,
            scale,
            background,
            no_loop,
            quantizer_speed,
            progress,
        } => {
            let control = if *progress {
                control::RenderControl::with_observer(|event| {
                    eprintln!("{}", serde_json::to_string(&event).expect("progress JSON"))
                })
            } else {
                control::RenderControl::default()
            };
            workspace.export_controlled(ExportRequest {
            project: project.clone(),
            format: match format {
                Format::Sequence => ExportFormat::Sequence,
                Format::Spritesheet => ExportFormat::Spritesheet,
                Format::Gif => ExportFormat::Gif,
                Format::Godot => ExportFormat::Godot,
                Format::Unity => ExportFormat::Unity,
            },
            fps: *fps,
            out: out.clone(),
            gif: if matches!(format, Format::Gif) {
                Some(GifSettings {
                    scale: scale.unwrap_or(1),
                    background: background
                        .as_ref()
                        .map(|v| rgb(v))
                        .transpose()?
                        .unwrap_or([0, 0, 0]),
                    repeat: !*no_loop,
                    quantizer_speed: quantizer_speed.unwrap_or(10),
                })
            } else {
                if scale.is_some() || background.is_some() || *no_loop || quantizer_speed.is_some()
                {
                    return Err(Error::new(
                        "INVALID_ARGUMENT",
                        "Scale, background, no-loop and quantizer-speed apply only to GIF exports",
                    ));
                }
                None
            },
        },&control)
        }
    }
}

fn main() -> ExitCode {
    let cli = match Cli::try_parse() {
        Ok(cli) => cli,
        Err(e) => {
            if e.exit_code() == 0 {
                let _ = e.print();
                return ExitCode::SUCCESS;
            }
            if std::env::args().any(|a| a == "--json") {
                println!(
                    "{}",
                    Error::new("INVALID_ARGUMENT", e.to_string()).envelope()
                );
            } else {
                let _ = e.print();
            }
            return ExitCode::from(2);
        }
    };
    let (value, code) = match run(&cli) {
        Ok(v) => (success(v), 0),
        Err(e) => (e.envelope(), e.exit_code()),
    };
    println!(
        "{}",
        if cli.json {
            value.to_string()
        } else {
            serde_json::to_string_pretty(&value).expect("JSON envelope")
        }
    );
    ExitCode::from(code)
}
