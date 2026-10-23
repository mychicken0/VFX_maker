import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const pkgVersion = JSON.parse(await readFile("package.json", "utf8")).version;
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const inventory = [],
  texts = [];
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path || entry.dev) continue;
  const name = path.slice(path.lastIndexOf("node_modules/") + 13);
  let pkg;
  try {
    pkg = JSON.parse(await readFile(`${path}/package.json`, "utf8"));
  } catch {
    continue;
  }
  const files = (await readdir(path)).filter((f) =>
    /^(licen[sc]e|notice|copying)(\.|$)/i.test(f),
  );
  const licenses = [];
  let licenseSource;
  for (const f of files) {
    try {
      const t = (await readFile(`${path}/${f}`, "utf8"))
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+$/gm, "");
      licenses.push(f);
      texts.push(
        `\n${"=".repeat(72)}\n${name}@${pkg.version} / ${f}\n${"=".repeat(72)}\n${t}\n`,
      );
    } catch {}
  }
  if (!licenses.length) {
    const fallback =
      name === "@pixi/colord"
        ? "docs/licenses/colord-LICENSE.txt"
        : name.startsWith("@esbuild/")
          ? "node_modules/esbuild/LICENSE.md"
          : undefined;
    if (fallback) {
      const t = (await readFile(fallback, "utf8"))
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+$/gm, "");
      licenses.push(fallback);
      texts.push(
        `\n${"=".repeat(72)}\n${name}@${pkg.version} / ${fallback}\n${"=".repeat(72)}\n${t}\n`,
      );
      licenseSource = {
        source:
          name === "@pixi/colord"
            ? "https://github.com/pixijs/colord/blob/5344fbf77b736f81cd33c21050021bc09bc9dd1d/LICENSE.md"
            : "License from the matching esbuild parent package",
        sha256: createHash("sha256").update(t).digest("hex"),
      };
    }
  }
  inventory.push({
    name,
    version: pkg.version,
    license: pkg.license ?? entry.license ?? "See package",
    repository: pkg.repository?.url ?? pkg.repository ?? null,
    integrity: entry.integrity,
    licenseFiles: licenses,
    ...(licenseSource ? { licenseSource } : {}),
  });
}
inventory.sort((a, b) => a.name.localeCompare(b.name));
await mkdir("docs/licenses", { recursive: true });
await writeFile(
  "docs/licenses/npm-runtime.json",
  JSON.stringify(inventory, null, 2) + "\n",
);
await writeFile(
  "docs/licenses/npm-runtime.txt",
  texts.join("").trimEnd() + "\n",
);
await writeFile(
  "THIRD_PARTY_NOTICES.md",
  `# Third-party notices\n\nVFX Maker ${pkgVersion} uses pinned npm packages. The browser build includes PixiJS, PixiJS Filters, React, React Flow, Three.js,\nZod, gifenc, fflate, UPNG.js, pako and their dependencies. Node tools use the official MCP SDK,\nCommander, Playwright Core and esbuild.\n\nThe exact installed runtime inventory, package integrity values and upstream\nrepository URLs are in [npm-runtime.json](docs/licenses/npm-runtime.json).\nUpstream license/notice texts are collected in [npm-runtime.txt](docs/licenses/npm-runtime.txt).\nRuntime inventory: ${inventory.length} installed packages, including the browser libraries.\nPlatform-specific optional packages may differ on another operating system.\n\nDemonstration textures are original project assets. Application code is original;\nupstream packages are included with their notices.\n\nVFX Maker application code is MIT licensed; see [LICENSE](LICENSE).\nUpstream packages retain their own licenses. Artcraft and Pixel Composer are\ndesign references only; no source or assets were copied from them. See\n[research notes](docs/RESEARCH_0.7.4.md) for inspected sources and decisions.\n`,
);
process.stdout.write(`${inventory.length} runtime package notices collected\n`);
