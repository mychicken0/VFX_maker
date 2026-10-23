import { readFile, writeFile, mkdir } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const version = pkg.version,
  archive = `vfx-maker-${version}.tgz`,
  output = resolve(process.argv[2] ?? ".");
await mkdir(output, { recursive: true });
const launcher = `import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, spawn } from "node:child_process";
const root = dirname(fileURLToPath(import.meta.url));
const runtime = join(root, ".vfx-runtime");
const entry = join(runtime, "node_modules/vfx-maker/dist/cli.js");
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) { console.error("Install Node.js 24 LTS, then open Start VFX Maker again."); process.exit(1); }
if (!existsSync(entry)) {
  const bin = dirname(realpathSync(process.execPath));
  const candidates = [join(bin, "node_modules/npm/bin/npm-cli.js"), resolve(bin, "../lib/node_modules/npm/bin/npm-cli.js"), process.env.npm_execpath].filter(Boolean);
  let npm = candidates.find(existsSync);
  if (!npm) {
    const query = spawnSync(process.platform === "win32" ? "where.exe" : "which", [process.platform === "win32" ? "npm.cmd" : "npm"], { encoding: "utf8" });
    for (const path of (query.stdout ?? "").trim().split(/\\r?\\n/)) {
      if (!path || !existsSync(path)) continue;
      const real = realpathSync(path);
      const possible = [real, join(dirname(real), "node_modules/npm/bin/npm-cli.js"), resolve(dirname(real), "../lib/node_modules/npm/bin/npm-cli.js")];
      npm = possible.find((p) => p.endsWith("npm-cli.js") && existsSync(p)); if (npm) break;
    }
  }
  if (!npm) { console.error("npm was not found. Reinstall Node.js 24 LTS including npm."); process.exit(1); }
  console.log("First launch: installing VFX Maker locally. Internet is needed once.");
  const install = spawnSync(process.execPath, [npm, "install", "--prefix", runtime, "--no-audit", "--no-fund", join(root, "${archive}")], { stdio: "inherit", cwd: root });
  if (install.status !== 0 || !existsSync(entry)) process.exit(install.status || 1);
}
const child = spawn(process.execPath, [entry, "studio", "--open", ...process.argv.slice(2)], { stdio: "inherit", cwd: root });
child.on("error", (e) => { console.error(e.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
process.on("SIGINT", () => { if (!child.killed) child.kill("SIGINT"); });
`;
const cmd = `@echo off\r\nwhere node >nul 2>nul\r\nif errorlevel 1 (\r\n  echo Install Node.js 24 LTS from https://nodejs.org then open this file again.\r\n  pause\r\n  exit /b 1\r\n)\r\nnode "%~dp0launch.mjs" %*\r\nif errorlevel 1 pause\r\n`;
const shell =
  '#!/bin/sh\ncd -- "$(dirname -- "$0")" || exit 1\nif ! command -v node >/dev/null 2>&1; then\n  echo "Install Node.js 24 LTS from https://nodejs.org then open this file again."\n  read -r answer\n  exit 1\nfi\nnode ./launch.mjs "$@"\n';
const readme = `VFX Maker ${version} — human Studio + AI-native CLI/MCP\n\n1. Install Node.js 24 LTS from https://nodejs.org once (includes npm).\n2. Extract this ZIP into a writable folder. Do not run inside the ZIP viewer.\n3. Windows: double-click Start VFX Maker.cmd.\n   macOS: open Start VFX Maker.command (if permissions were stripped, use chmod +x).\n   Linux: run ./Start-VFX-Maker.sh or node launch.mjs.\n4. Your browser opens Studio. Keep its Terminal window running. Ctrl+C stops it.\n\nFirst launch downloads dependencies into .vfx-runtime inside this folder. Subsequent\nlaunches use that installation. No administrator/global install or repository needed.\nThe ZIP requires Node; it is not a bundled desktop executable. Linux/Chromium is\ntested. Windows and macOS launch scripts are supplied but unverified on those OSes.\nIf the browser does not open, use the local Studio URL printed in the Terminal.\nIf the default port is busy: node launch.mjs --port 4180\n\nStudio: choose an effect from Library → Effects, or use the current effect.\nMove/Scale/Rotate tools work directly on the canvas. Wheel zooms, middle drag pans,\nF fits. Select a stroke and Points for anchors, or draw with Pen (Enter finishes).\nDrag the thick Timeline divider, use +/− for time zoom, or Focus timeline.\nAdvanced settings start folded. Blueprint opens the detailed control/node editor.\n2D stays the default. 2.5D / 3D opens a separate camera/plane stage and camera exports.\nSave project keeps editable data; Export writes GIF/spritesheet/game assets.\n\nAI agents: node .vfx-runtime/node_modules/vfx-maker/dist/mcp.js --root /your/projects\nUse capabilities → new_project → get_blueprint/observe_project → draft edits →\napply_edits → analyze_project → export. Read the built-in vfx://guide resource.\n\nMIT License: see LICENSE. Upstream notices: THIRD_PARTY_NOTICES.md and the installed\npackage's docs/licenses directory. Source: https://github.com/mychicken0/VFX_maker\n`;
const files = {
  [archive]: await readFile(archive),
  "launch.mjs": strToU8(launcher),
  "Start VFX Maker.cmd": strToU8(cmd),
  "Start VFX Maker.command": [
    strToU8(shell),
    { os: 3, attrs: (0o100755 << 16) >>> 0 },
  ],
  "Start-VFX-Maker.sh": [
    strToU8(shell),
    { os: 3, attrs: (0o100755 << 16) >>> 0 },
  ],
  "START-HERE.txt": strToU8(readme),
  LICENSE: await readFile("LICENSE"),
  "THIRD_PARTY_NOTICES.md": await readFile("THIRD_PARTY_NOTICES.md"),
  "docs/RESEARCH_0.7.4.md": await readFile("docs/RESEARCH_0.7.4.md"),
  "docs/licenses/npm-runtime.json": await readFile(
    "docs/licenses/npm-runtime.json",
  ),
  "docs/licenses/npm-runtime.txt": await readFile(
    "docs/licenses/npm-runtime.txt",
  ),
};
const zip = zipSync({ [`vfx-maker-${version}`]: files }, { level: 6 });
const name = `vfx-maker-${version}-studio.zip`;
await writeFile(joinOutput(name), zip);
function joinOutput(name) {
  return resolve(output, name);
}
const sha = createHash("sha256").update(zip).digest("hex");
await writeFile(joinOutput(`${name}.sha256`), `${sha}  ${name}\n`);
process.stdout.write(
  JSON.stringify({
    file: joinOutput(name),
    bytes: zip.byteLength,
    sha256: sha,
  }) + "\n",
);
