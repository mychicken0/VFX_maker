// Actual MCP batch -> GIF/Godot -> numeric QA for the eight reviewed presets.
// node scripts/verify-project-workflows.mjs NEW_ROOT [MCP_ENTRY]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const root = resolve(process.argv[2] ?? ""),
  server = resolve(process.argv[3] ?? "dist/mcp.js");
if (!process.argv[2]) throw Error("Provide a fresh output directory");
await mkdir(root);
const client = new Client({
    name: "vfx-project-workflow-replay",
    version: "1",
  }),
  transcript = [];
const presets = [
  "blue_magic",
  "smoke",
  "dust",
  "rain",
  "heal_pulse",
  "stardust",
  "masked_portal",
  "pixel_flame",
];
async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  assert(!r.isError, JSON.stringify(r));
  const value = r.structuredContent;
  transcript.push({ tool: name, arguments: args, result: value });
  return value;
}
async function finish(job) {
  for (let i = 0; i < 2000; i++) {
    const state = await call("get_export_job", { id: job.id });
    if (["succeeded", "failed", "cancelled"].includes(state.status)) {
      assert.equal(state.status, "succeeded", JSON.stringify(state));
      return state.result;
    }
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error("Batch timeout");
}
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [server, "--root", root],
      cwd: root,
      stderr: "pipe",
    }),
  );
  const items = Array.from({ length: 16 }, (_, i) => ({
    action: "create",
    file: `${i}.vfx.json`,
    preset: presets[i % 8],
    seed: 42 + i,
    edits: [
      {
        action: "update_project",
        patch: { name: `${i < 8 ? "Cool" : "Warm"} ${presets[i % 8]}` },
      },
      {
        action: "set_gradient",
        colors: [
          { t: 0, color: i < 8 ? "#ede5ff" : "#fff1d0" },
          { t: 1, color: i < 8 ? "#804cff" : "#ff6633" },
        ],
      },
      {
        action: "creative",
        operation: {
          action: "set_control",
          id: "size",
          value: i < 8 ? 0.9 : 1.1,
        },
      },
    ],
    out: `gif-${i}`,
    options: { format: "gif", scale: 2 },
  }));
  await writeFile(
    join(root, "tasks.json"),
    JSON.stringify(items, null, 2) + "\n",
  );
  const dry = await call("batch_projects", { items, dryRun: true });
  assert(dry.ok);
  const created = await finish(await call("batch_projects", { items }));
  assert(created.ok);
  assert.equal(created.results.length, 16);
  const engineTasks = created.results.map((r) => ({
    action: "export",
    file: r.file,
    revision: r.revision,
    out: `godot-${r.index}`,
    options: { format: "godot" },
  }));
  const exported = await finish(
    await call("batch_projects", { items: engineTasks }),
  );
  assert(exported.ok);
  const results = [];
  for (const item of created.results) {
    const qa = await call("analyze_project", {
      file: item.file,
      revision: item.revision,
      times: [0.1, 0.35, 0.6, 0.9],
      out: `qa-${item.index}.json`,
    });
    assert(qa.ok && qa.parity.passed);
    const gif = await readFile(join(root, `gif-${item.index}/animation.gif`));
    results.push({
      index: item.index,
      preset: presets[item.index % 8],
      revision: item.revision,
      parity: qa.parity.passed,
      visibleFrames: qa.summary.visibleFrames,
      peak: qa.summary.peakAlphaMass,
      gif: { bytes: gif.length, sha256: sha(gif) },
    });
  }
  const baseline = await call("analyze_project", {
    file: "1.vfx.json",
    baseline: "qa-1.json",
  });
  assert(baseline.ok && baseline.baseline.passed);
  for (const index of [1, 11]) {
    const seen = await call("observe_project", {
      file: `${index}.vfx.json`,
      view: "storyboard",
    });
    await call("save_preview", {
      uri: seen.images.find((i) => i.role === "annotated").uri,
      out: `storyboard-${index}.png`,
    });
  }
  const capability = await call("capabilities");
  const manifest = {
    version: capability.version,
    protocol: "official MCP SDK stdio",
    projects: 16,
    formats: ["gif", "godot"],
    renderer: capability.renderer,
    baselinePassed: true,
    results,
  };
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await writeFile(
    join(root, "transcript.json"),
    JSON.stringify(transcript, null, 2) + "\n",
  );
  const escape = (s) =>
    s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll('"', "&quot;");
  await writeFile(
    join(root, "index.html"),
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>VFX Maker ${escape(manifest.version)} MCP batch</title><style>body{background:#15121d;color:#eee;font:15px system-ui;margin:32px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}article{background:#251f31;padding:16px;border-radius:10px}img{width:100%;image-rendering:pixelated}a{color:#c9abff;margin-right:10px}p{color:#c0b6cc}</style><h1>16 projects through MCP</h1><p>Real GIF/Godot exports; numeric parity at four explicit times per project. Activity peak is not a game hit marker.</p><main>${results.map((r) => `<article><h2>${r.index < 8 ? "Cool" : "Warm"} ${escape(r.preset)}</h2><img src="gif-${r.index}/animation.gif" alt="${escape(r.preset)}"><p>Parity passed · ${r.visibleFrames}/4 visible samples</p><a href="${r.index}.vfx.json">Project</a><a href="godot-${r.index}/effect.tres">Godot</a><a href="qa-${r.index}.json">QA</a></article>`).join("")}</main></html>`,
  );
  console.log(
    JSON.stringify(
      {
        root,
        projects: 16,
        renderer: manifest.renderer,
        allParityPassed: results.every((r) => r.parity),
        baselinePassed: true,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
