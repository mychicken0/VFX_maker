// Fixed workload through the official SDK; compares cold and warm calls honestly.
// node scripts/benchmark-agent.mjs SERVER_ENTRY FRESH_ROOT REPORT_JSON
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const [entry, folder, destination] = process.argv.slice(2);
if (!destination) throw Error("Use SERVER_ENTRY FRESH_ROOT REPORT_JSON");
const root = resolve(folder);
await mkdir(root);
const client = new Client({ name: "vfx-fixed-workload", version: "1" }),
  samples = [];
async function call(name, args = {}) {
  const start = performance.now(),
    r = await client.callTool({ name, arguments: args });
  if (r.isError) throw Error(JSON.stringify(r));
  return { response: r, ms: performance.now() - start };
}
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve(entry), "--root", root],
      cwd: root,
      stderr: "pipe",
    }),
  );
  const caps = (await call("capabilities")).response.structuredContent;
  await call("new_project", { file: "effect.json", preset: "red_magic_cross" });
  const times = [0, 7 / 30, 0.385, 14 / 30, 28 / 30, 35 / 30];
  for (let i = 0; i < 4; i++) {
    const { response, ms } = await call("observe_project", {
      file: "effect.json",
      view: "storyboard",
      times,
    });
    const image = response.content.find((c) => c.type === "image"),
      bytes = Buffer.from(image.data, "base64");
    samples.push({
      operation: "storyboard",
      phase: i === 0 ? "cold" : "warm",
      ms,
      inlinePngSha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    });
  }
  for (const time of [0.3, 0.4, 0.5]) {
    const { response, ms } = await call("render_preview", {
        file: "effect.json",
        time,
      }),
      image = response.content.find((c) => c.type === "image");
    samples.push({
      operation: "preview",
      phase: "warm",
      time,
      ms,
      inlinePngSha256: createHash("sha256")
        .update(Buffer.from(image.data, "base64"))
        .digest("hex"),
    });
  }
  const final = (await call("capabilities")).response.structuredContent;
  const report = {
    version: caps.version,
    platform: process.platform,
    node: process.version,
    workload:
      "128x128 Crimson cross; six identical explicit times; default guides/grid; separate stdio process",
    samples,
    renderer: final.renderer ?? null,
  };
  await writeFile(resolve(destination), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.close();
}
