// Real stdio MCP: discover -> draft graph edits -> commit -> verify -> export.
// node scripts/verify-blueprint-agent.mjs NEW_ROOT [MCP_ENTRY]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const root = resolve(process.argv[2] ?? ""),
  entry = resolve(process.argv[3] ?? "dist/mcp.js");
if (!process.argv[2]) throw Error("Supply a fresh output directory");
await mkdir(root);
const client = new Client({ name: "blueprint-agent-replay", version: "1" }),
  transcript = [];
const call = async (tool, args = {}) => {
  const r = await client.callTool({ name: tool, arguments: args });
  assert(!r.isError, JSON.stringify(r));
  const result = r.structuredContent;
  transcript.push({ tool, arguments: args, result });
  return result;
};
const clean = (r) => r.images.find((im) => im.role === "frame");
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [entry, "--root", root],
      cwd: root,
      stderr: "pipe",
    }),
  );
  const capabilities = await call("capabilities");
  await call("new_project", {
    file: "blueprint.vfx.json",
    preset: "blue_magic",
    seed: 74,
  });
  const graph = await call("get_blueprint", { file: "blueprint.vfx.json" }),
    layer = graph.layers.find(
      (l) => !l.locked && l.inputs.some((p) => p.path === "rotation"),
    );
  assert(layer);
  const before = await call("observe_project", {
    file: "blueprint.vfx.json",
    time: 0.35,
  });
  await call("save_preview", { uri: clean(before).uri, out: "before.png" });
  const edits = [
    {
      action: "creative",
      operation: {
        action: "put_control",
        control: {
          id: "direction",
          name: "Direction",
          min: -180,
          max: 180,
          value: 35,
          step: 1,
          bindings: [],
        },
      },
    },
    {
      action: "connect_control",
      control: "direction",
      layer: layer.id,
      target: "rotation",
      mode: "add",
    },
    {
      action: "set_gradient",
      colors: [
        { t: 0, color: "#e9dfff" },
        { t: 1, color: "#8c40f3" },
      ],
    },
    {
      action: "creative",
      operation: {
        action: "put_modifier",
        layer: layer.id,
        modifier: {
          id: "violet-edge",
          type: "outline",
          thickness: 1,
          color: "#ab7bff",
          alpha: 0.7,
        },
      },
    },
  ];
  await writeFile(
    join(root, "edits.json"),
    JSON.stringify(edits, null, 2) + "\n",
  );
  const source = await readFile(join(root, "blueprint.vfx.json"), "utf8");
  await call("apply_edits", {
    file: "blueprint.vfx.json",
    revision: graph.revision,
    edits,
    dryRun: true,
  });
  assert.equal(
    await readFile(join(root, "blueprint.vfx.json"), "utf8"),
    source,
  );
  const draft = await call("observe_project", {
    file: "blueprint.vfx.json",
    revision: graph.revision,
    edits,
    time: 0.35,
  });
  await call("save_preview", { uri: draft.images[0].uri, out: "draft.png" });
  await call("apply_edits", {
    file: "blueprint.vfx.json",
    revision: graph.revision,
    edits,
  });
  const committed = await call("observe_project", {
    file: "blueprint.vfx.json",
    time: 0.35,
  });
  assert.equal(clean(committed).sha256, clean(draft).sha256);
  await call("save_preview", { uri: clean(committed).uri, out: "after.png" });
  const report = await call("analyze_project", {
    file: "blueprint.vfx.json",
    times: [0.15, 0.35, 0.55],
    out: "baseline.json",
  });
  assert.equal(report.ok, true);
  assert.equal(report.parity.passed, true);
  const updated = await call("get_blueprint", { file: "blueprint.vfx.json" });
  const layout = await call("apply_edits", {
    file: "blueprint.vfx.json",
    revision: updated.revision,
    edits: [
      {
        action: "update_project",
        patch: {
          editor: {
            blueprint: {
              "control:direction": { x: -80, y: 480 },
              [`layer:${layer.id}`]: { x: 370, y: 60 },
            },
          },
        },
      },
    ],
  });
  const comparison = await call("analyze_project", {
    file: "blueprint.vfx.json",
    baseline: "baseline.json",
  });
  assert.equal(comparison.baseline.passed, true); // Node layout must not alter effect pixels.
  const plan = await call("preflight_export", {
    file: "blueprint.vfx.json",
    options: { format: "gif", scale: 3 },
  });
  assert.equal(plan.ok, true);
  for (const format of ["gif", "godot"]) {
    const job = await call("start_export", {
      file: "blueprint.vfx.json",
      revision: layout.revision,
      out: format,
      options: { format, scale: format === "gif" ? 3 : 1 },
    });
    for (let i = 0; ; i++) {
      if (i > 1000) throw Error("Export timed out");
      const state = await call("get_export_job", { id: job.id });
      if (["succeeded", "failed", "cancelled"].includes(state.status)) {
        assert.equal(state.status, "succeeded", JSON.stringify(state));
        break;
      }
      await new Promise((r) => setTimeout(r, 30));
    }
  }
  const storyboard = await call("observe_project", {
    file: "blueprint.vfx.json",
    view: "storyboard",
  });
  await call("save_preview", {
    uri: storyboard.images[0].uri,
    out: "storyboard.png",
  });
  const finalGraph = await call("get_blueprint", {
    file: "blueprint.vfx.json",
  });
  await writeFile(
    join(root, "graph.json"),
    JSON.stringify(finalGraph, null, 2) + "\n",
  );
  await writeFile(
    join(root, "transcript.json"),
    JSON.stringify(transcript, null, 2) + "\n",
  );
  const manifest = {
    version: capabilities.version,
    tools: (await client.listTools()).tools.length,
    dryRunKeptSource: true,
    draftCommittedFrameSha256: clean(committed).sha256,
    reverseOrderParity: report.parity,
    editorLayoutPreservedBaseline: comparison.baseline,
    revision: layout.revision,
    renderer: (await call("capabilities")).renderer,
    formats: ["gif", "godot"],
  };
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  process.stdout.write(JSON.stringify(manifest) + "\n");
} finally {
  await client.close();
}
