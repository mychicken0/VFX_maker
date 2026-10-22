// Interactive official-SDK client for manually inspecting a real MCP session.
// JSON lines: {tool,arguments}, {resource}, {prompt,arguments}, {list:true}, {close:true}.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";
const root = resolve(process.argv[2] ?? "."),
  out = resolve(process.argv[3] ?? join(root, "mcp-evidence")),
  server = resolve(process.env.VFX_MCP_ENTRY ?? "dist/mcp.js");
await mkdir(out, { recursive: true });
const client = new Client({ name: "vfx-manual-inspection", version: "1" }),
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [server, "--root", root],
    stderr: "pipe",
  });
let step = 0;
const transcript = [];
await client.connect(transport);
console.log(JSON.stringify({ ready: true, root, out, server }));
try {
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    try {
      const request = JSON.parse(line);
      if (request.close) break;
      const result = request.tool
        ? await client.callTool({
            name: request.tool,
            arguments: request.arguments ?? {},
          })
        : request.resource
          ? await client.readResource({ uri: request.resource })
          : request.prompt
            ? await client.getPrompt({
                name: request.prompt,
                arguments: request.arguments,
              })
            : {
                tools: await client.listTools(),
                resources: await client.listResources(),
                prompts: await client.listPrompts(),
              };
      const number = ++step;
      let index = 0;
      const sanitize = async (value) => {
        if (!value || typeof value !== "object") return value;
        if (Array.isArray(value)) return Promise.all(value.map(sanitize));
        if (
          value.type === "image" ||
          (value.mimeType === "image/png" && value.blob)
        ) {
          const path = join(
            out,
            `${String(number).padStart(2, "0")}-${++index}.png`,
          );
          await writeFile(
            path,
            Buffer.from(value.data ?? value.blob, "base64"),
          );
          return {
            ...value,
            data: undefined,
            blob: undefined,
            savedImage: path,
          };
        }
        return Object.fromEntries(
          await Promise.all(
            Object.entries(value).map(async ([k, v]) => [k, await sanitize(v)]),
          ),
        );
      };
      const clean = await sanitize(result);
      transcript.push({ step: number, request, result: clean });
      await writeFile(
        join(out, "transcript.json"),
        JSON.stringify(transcript, null, 2) + "\n",
      );
      // Structured output already repeats the text JSON. Keep the terminal readable.
      if (clean.structuredContent)
        clean.content = clean.content.filter((c) => c.type !== "text");
      console.log(JSON.stringify({ step: number, ...clean }));
    } catch (error) {
      console.log(JSON.stringify({ error: error.message }));
    }
  }
} finally {
  await client.close();
}
