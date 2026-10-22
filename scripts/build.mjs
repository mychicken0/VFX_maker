import { build as bundle } from "esbuild";
import { build as web } from "vite";
import { rm, chmod } from "node:fs/promises";
import { execFileSync } from "node:child_process";
await rm("dist", { recursive: true, force: true });
await web();
await bundle({
  entryPoints: {
    cli: "src/node/cli.ts",
    mcp: "src/node/mcp.ts",
    core: "src/core/index.ts",
    renderer: "src/render/pixi.ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outdir: "dist",
  packages: "external",
  sourcemap: true,
});
execFileSync(
  process.execPath,
  ["node_modules/typescript/bin/tsc", "--emitDeclarationOnly"],
  { stdio: "inherit" },
);
await chmod("dist/cli.js", 0o755);
await chmod("dist/mcp.js", 0o755);
