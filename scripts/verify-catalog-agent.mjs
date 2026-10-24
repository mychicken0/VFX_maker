// A real SDK/stdio session builds an effect using the same Add catalog as Studio.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const root = resolve(process.argv[2] ?? ""),
  entry = resolve(process.argv[3] ?? "dist/mcp.js");
if (!process.argv[2]) throw Error("Supply a new output directory");
await mkdir(root);
const client = new Client({ name: "catalog-agent", version: "1" }),
  transcript = [];
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  assert(!r.isError, JSON.stringify(r));
  const result = r.structuredContent;
  transcript.push({ tool: name, arguments: args, result });
  return result;
};
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [entry, "--root", root],
      cwd: root,
      stderr: "pipe",
    }),
  );
  const cap = await call("capabilities");
  await call("new_project", {
    file: "aura.vfx.json",
    project: {
      name: "Catalog aura",
      duration: 1.2,
      fps: 24,
      seed: 75,
      layers: [],
    },
  });
  const menu = await call("get_node_catalog", { file: "aura.vfx.json" }),
    ring = structuredClone(
      menu.entries.find((e) => e.id === "layer:ring").edit,
    ),
    sparks = structuredClone(
      menu.entries.find((e) => e.id === "layer:particles").edit,
    );
  ring.layer.name = "Arc field";
  sparks.layer.name = "Rising motes";
  sparks.layer.count = 48;
  sparks.layer.angle = -90;
  sparks.layer.spread = 35;
  sparks.layer.speed = [30, 65];
  sparks.layer.life = [0.5, 1];
  sparks.layer.position.y = 82;
  await call("apply_edits", {
    file: "aura.vfx.json",
    revision: menu.revision,
    edits: [ring, sparks],
  });
  const context = await call("get_node_catalog", {
      file: "aura.vfx.json",
      layer: ring.layer.id,
    }),
    outline = structuredClone(
      context.entries.find((e) => e.id === "modifier:outline").edit,
    ),
    number = structuredClone(
      context.entries.find((e) => e.id === "control:number").edit,
    );
  number.operation.control.name = "Arc";
  number.operation.control.value = 270;
  const edits = [
    outline,
    number,
    {
      action: "connect_control",
      control: number.operation.control.id,
      layer: ring.layer.id,
      target: "arc",
      mode: "set",
    },
    {
      action: "set_gradient",
      colors: [
        { t: 0, color: "#e0ffff" },
        { t: 1, color: "#49baff" },
      ],
    },
    {
      action: "configure_stage",
      patch: {
        mode: "2.5d",
        projection: "orthographic",
        azimuth: 30,
        elevation: 38,
        span: 110,
        plane: "ground",
      },
    },
    {
      action: "place_stage_layer",
      id: sparks.layer.id,
      patch: { plane: "billboard", position: { y: 18 } },
    },
  ];
  const before = await readFile(join(root, "aura.vfx.json"), "utf8");
  const draft = await call("render_preview", {
    file: "aura.vfx.json",
    revision: context.revision,
    edits,
    view: "stage",
    time: 0.35,
  });
  assert.equal(await readFile(join(root, "aura.vfx.json"), "utf8"), before);
  await call("save_preview", { uri: draft.images[0].uri, out: "draft.png" });
  const saved = await call("apply_edits", {
    file: "aura.vfx.json",
    revision: context.revision,
    edits,
  });
  const image = await call("render_preview", {
    file: "aura.vfx.json",
    view: "stage",
    time: 0.35,
  });
  assert.equal(image.images[0].sha256, draft.images[0].sha256);
  assert(image.pixels.visiblePixels > 0);
  await call("save_preview", { uri: image.images[0].uri, out: "camera.png" });
  const qa = await call("analyze_project", {
    file: "aura.vfx.json",
    view: "stage",
    times: [0.2, 0.35, 0.55, 0.75],
    out: "baseline.json",
  });
  assert.equal(qa.parity.passed, true);
  for (const format of ["gif", "godot"]) {
    const job = await call("start_export", {
      file: "aura.vfx.json",
      revision: saved.revision,
      out: format,
      options: { format, view: "stage", scale: format === "gif" ? 3 : 1 },
    });
    for (let i = 0; ; i++) {
      if (i > 1500) throw Error("Export timed out");
      const state = await call("get_export_job", { id: job.id });
      if (["succeeded", "failed", "cancelled"].includes(state.status)) {
        assert.equal(state.status, "succeeded", JSON.stringify(state));
        break;
      }
      await new Promise((r) => setTimeout(r, 40));
    }
  }
  const graph = await call("get_blueprint", { file: "aura.vfx.json" }),
    stage = await call("get_stage", { file: "aura.vfx.json" });
  const manifest = {
    version: cap.version,
    tools: (await client.listTools()).tools.length,
    draftKeptSource: true,
    draftCommitPngSha256: image.images[0].sha256,
    parity: qa.parity,
    formats: ["gif", "godot"],
  };
  for (const [name, value] of Object.entries({
    "manifest.json": manifest,
    "transcript.json": transcript,
    "graph.json": graph,
    "stage.json": stage,
    "edits.json": edits,
  }))
    await writeFile(join(root, name), JSON.stringify(value, null, 2) + "\n");
  console.log(JSON.stringify(manifest));
} finally {
  await client.close();
}
