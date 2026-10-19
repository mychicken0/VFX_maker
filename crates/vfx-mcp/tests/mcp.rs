use base64::{Engine, engine::general_purpose::STANDARD};
use rmcp::{
    RoleClient, ServiceExt,
    model::{CallToolRequestParams, CallToolResult, ContentBlock},
    service::RunningService,
    transport::TokioChildProcess,
};
use serde_json::{Value, json};
use vfx_core::{
    ExportFormat, ExportRequest, NewProject, Operation, Patch, PreviewRequest, Workspace,
};

async fn call(
    client: &RunningService<RoleClient, ()>,
    name: &'static str,
    args: Value,
) -> CallToolResult {
    client
        .call_tool(
            CallToolRequestParams::new(name).with_arguments(args.as_object().unwrap().clone()),
        )
        .await
        .unwrap()
}
fn data(result: CallToolResult) -> Value {
    assert_ne!(result.is_error, Some(true), "{result:?}");
    result.structured_content.unwrap()["data"].clone()
}

#[tokio::test]
async fn sdk_client_can_author_preview_export_and_share_projects_with_the_core() {
    tokio::time::timeout(std::time::Duration::from_secs(20),async {
        let dir=tempfile::tempdir().unwrap();
        let workspace=Workspace::new(dir.path()).unwrap();
        let mut command=tokio::process::Command::new(env!("CARGO_BIN_EXE_vfx-mcp"));
        command.arg("--root").arg(dir.path()).arg("--stdio").current_dir(dir.path()).env_remove("DISPLAY").env_remove("WAYLAND_DISPLAY");
        let client=().serve(TokioChildProcess::new(command).unwrap()).await.unwrap();
        let tools=client.list_all_tools().await.unwrap();assert_eq!(tools.len(),13);
        assert!(tools.iter().all(|tool|tool.input_schema.get("type").is_some()));
        assert_eq!(data(call(&client,"vfx_get_capabilities",json!({})).await)["headless"],true);
        assert!(data(call(&client,"vfx_list_presets",json!({})).await).as_array().unwrap().len()>=12);
        let via_mcp=data(call(&client,"vfx_new_project",json!({"path":"mcp.vfxproj","seed":42})).await);
        let via_core=workspace.new_project(serde_json::from_value::<NewProject>(json!({"path":"core.vfxproj","seed":42})).unwrap()).unwrap();
        assert_eq!(via_mcp,via_core);
        let ops=json!([{"op":"set_name","name":"Shared effect"}]);
        let dry=data(call(&client,"vfx_apply_patch",json!({"project":"mcp.vfxproj","expected_revision":0,"operations":ops,"dry_run":true})).await);
        assert_eq!(dry["revision"],0);
        assert_eq!(workspace.read_project("mcp.vfxproj").unwrap().revision,0);
        let patched=data(call(&client,"vfx_apply_patch",json!({"project":"mcp.vfxproj","expected_revision":0,"operations":ops})).await);
        let core=workspace.patch(Patch{project:"core.vfxproj".into(),expected_revision:0,operations:vec![Operation::SetName{name:"Shared effect".into()}],dry_run:false}).unwrap();
        assert_eq!(patched,core);
        let stale=call(&client,"vfx_apply_patch",json!({"project":"mcp.vfxproj","expected_revision":0,"operations":ops})).await;
        assert_eq!(stale.is_error,Some(true));assert_eq!(stale.structured_content.unwrap()["error"]["code"],"REVISION_CONFLICT");
        let failed=call(&client,"vfx_apply_patch",json!({"project":"mcp.vfxproj","expected_revision":1,"operations":[{"op":"set_name","name":"bad"},{"op":"set_canvas","canvas":{"width":0,"height":64,"pixel_mode":true}}]})).await;
        assert_eq!(failed.is_error,Some(true));
        assert_eq!(data(call(&client,"vfx_inspect_project",json!({"project":"mcp.vfxproj"})).await),core);
        assert_eq!(data(call(&client,"vfx_validate",json!({"project":"mcp.vfxproj"})).await)["valid"],true);
        let preview=call(&client,"vfx_render_preview",json!({"project":"mcp.vfxproj","times":[0.15,0.3]})).await;
        assert_ne!(preview.is_error,Some(true));
        let image=preview.content.iter().find_map(|c|match c {ContentBlock::Image(i)=>Some(i),_=>None}).expect("inline preview image");
        assert_eq!(image.mime_type,"image/png");
        let bytes=STANDARD.decode(&image.data).unwrap();assert_eq!(&bytes[..8],b"\x89PNG\r\n\x1a\n");
        let reference=workspace.preview(PreviewRequest{project:"core.vfxproj".into(),times:vec![0.15,0.3]}).unwrap();assert_eq!(bytes,reference.png);
        let escape=call(&client,"vfx_new_project",json!({"path":"../outside.vfxproj"})).await;
        assert_eq!(escape.is_error,Some(true));assert_eq!(escape.structured_content.unwrap()["error"]["code"],"PATH_OUTSIDE_ROOT");
        data(call(&client,"vfx_export",json!({"project":"mcp.vfxproj","out":"mcp-atlas","format":"spritesheet","fps":20})).await);
        workspace.export(ExportRequest{gif:None,project:"core.vfxproj".into(),out:"core-atlas".into(),format:ExportFormat::Spritesheet,fps:20}).unwrap();
        for file in ["atlas.png","metadata.json"] {assert_eq!(std::fs::read(dir.path().join("mcp-atlas").join(file)).unwrap(),std::fs::read(dir.path().join("core-atlas").join(file)).unwrap());}
        assert_eq!(data(call(&client,"vfx_undo",json!({"project":"mcp.vfxproj","expected_revision":1})).await)["revision"],2);
        assert_eq!(data(call(&client,"vfx_redo",json!({"project":"mcp.vfxproj","expected_revision":2})).await)["revision"],3);
        let recipe=data(call(&client,"vfx_get_preset",json!({"id":"red_magic_cross"})).await);
        assert!(recipe["recipe"]["parameters"]["edge_color"].is_object());
        let red=data(call(&client,"vfx_new_project",json!({"path":"red.vfxproj","preset":"red_magic_cross","params":{"edge_color":[255,5,45,255],"core_width":1.3}})).await);
        assert_eq!(red["scene"]["name"],"Crimson Cross");
        let animated=data(call(&client,"vfx_export",json!({"project":"red.vfxproj","out":"gif","format":"gif","fps":25,"gif":{"scale":2,"background":[16,8,17],"repeat":false}})).await);
        assert_eq!(animated["frame_count"],30);
        assert!(std::fs::read(dir.path().join("gif/animation.gif")).unwrap().starts_with(b"GIF89a"));
        client.cancel().await.unwrap();
    }).await.expect("MCP workflow timed out");
}

#[tokio::test]
async fn stdout_is_json_rpc_only_and_oversized_frames_are_rejected() {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    tokio::time::timeout(std::time::Duration::from_secs(15),async {
        let dir=tempfile::tempdir().unwrap();
        let mut child=tokio::process::Command::new(env!("CARGO_BIN_EXE_vfx-mcp")).arg("--root").arg(dir.path()).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true).spawn().unwrap();
        let mut input=child.stdin.take().unwrap();let mut output=BufReader::new(child.stdout.take().unwrap());
        input.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},\"clientInfo\":{\"name\":\"wire-test\",\"version\":\"1\"}}}\n").await.unwrap();
        let mut line=String::new();output.read_line(&mut line).await.unwrap();let message:Value=serde_json::from_str(&line).expect("stdout must contain only JSON-RPC");assert_eq!(message["id"],1);assert!(message["result"]["capabilities"]["tools"].is_object());
        input.write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}\n").await.unwrap();
        line.clear();output.read_line(&mut line).await.unwrap();let message:Value=serde_json::from_str(&line).unwrap();assert_eq!(message["id"],2);assert_eq!(message["result"]["tools"].as_array().unwrap().len(),13);
        // A single over-limit line must close transport without being parsed or logged to stdout.
        let large=vec![b' ';4*1024*1024+32];
        let _=input.write_all(&large).await;
        drop(input);
        line.clear();assert_eq!(output.read_line(&mut line).await.unwrap(),0);
        child.wait().await.unwrap();
    }).await.expect("MCP wire check timed out");
}
