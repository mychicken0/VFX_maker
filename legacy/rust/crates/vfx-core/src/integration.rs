//! Engine adapters consume the same baked pixels and manifest timing as generic exports.
use crate::{graph::Compiled, model::*};
use serde_json::Value;
pub fn periodic(scene: &Scene, graph: &Compiled) -> bool {
    let divides = |period: f64| {
        let n = scene.simulation.duration_seconds / period;
        n >= 1.0 && (n - n.round()).abs() < 1e-8
    };
    graph.pipelines.iter().all(|p|p.modifiers.iter().any(|m|matches!(m,NodeKind::Timeline{settings} if settings.repeat&&settings.delay_seconds==0.0&&divides(settings.duration_seconds))))&&scene.post_process.iter().all(|e|match e{PostProcess::WaveDistortion{period_seconds,..}=>divides(*period_seconds),_=>true})
}
pub fn files(
    format: ExportFormat,
    frames: &[Value],
    fps: u32,
    repeat: bool,
) -> Vec<(&'static str, Vec<u8>)> {
    match format {
        ExportFormat::Godot=>{
            let mut text=format!("[gd_resource type=\"SpriteFrames\" load_steps={} format=3]\n\n[ext_resource type=\"Texture2D\" path=\"atlas.png\" id=\"1_atlas\"]\n",frames.len()+2);
            for frame in frames {
                let r=&frame["rect"];text+=&format!("\n[sub_resource type=\"AtlasTexture\" id=\"AtlasTexture_{}\"]\natlas = ExtResource(\"1_atlas\")\nregion = Rect2({}, {}, {}, {})\n",frame["index"],r["x"],r["y"],r["width"],r["height"]);
            }
            text+="\n[resource]\nanimations = [{\n\"frames\": [\n";
            for(i,frame)in frames.iter().enumerate(){
                let duration=frame["duration_ms"].as_f64().expect("export duration")*f64::from(fps)/1000.0;
                text+=&format!("{{\"duration\": {duration:.12}, \"texture\": SubResource(\"AtlasTexture_{}\")}}{}\n",frame["index"],if i+1==frames.len(){""}else{","});
            }
            text+=&format!("],\n\"loop\": {repeat},\n\"name\": &\"effect\",\n\"speed\": {fps}.0\n}}]\n");
            vec![("effect.tres",text.into_bytes()),("IMPORT.txt",b"Godot 4: copy this folder into your project, allow texture import, then assign effect.tres to an AnimatedSprite2D's sprite_frames. Play the 'effect' animation. Frame rectangles include transparent padding; durations preserve the export window. For pixel art set AnimatedSprite2D.texture_filter to NEAREST. This is baked playback, not a runtime particle system.\n".to_vec())]
        }
        ExportFormat::Unity=>vec![("Editor/VfxMakerImport.cs",include_bytes!("../../../integrations/unity/Editor/VfxMakerImport.cs").to_vec()),("IMPORT.txt",b"Unity 2022.3+ with com.unity.2d.sprite: copy the entire output folder under Assets. Select metadata.json and use Assets > VFX Maker > Import selected metadata. The Editor integration creates sliced sprites and a new effect.anim clip targeting SpriteRenderer.m_Sprite. Sprite IDs are retained on reimport; existing clips are preserved with unique output names. Coordinates are converted from top-left to bottom-left. Pixels-per-unit defaults to 100; adjust it for your game. This generates baked assets and requires the Unity Editor; the Unity host integration has not been exercised by Rust tests.\n".to_vec())],
        _=>vec![],
    }
}
