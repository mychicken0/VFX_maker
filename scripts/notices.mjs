import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
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
  inventory.push({
    name,
    version: pkg.version,
    license: pkg.license ?? entry.license ?? "See package",
    repository: pkg.repository?.url ?? pkg.repository ?? null,
    integrity: entry.integrity,
    licenseFiles: licenses,
  });
}
inventory.sort((a, b) => a.name.localeCompare(b.name));
await mkdir("docs/licenses", { recursive: true });
await writeFile(
  "docs/licenses/npm-runtime.json",
  JSON.stringify(inventory, null, 2) + "\n",
);
await writeFile("docs/licenses/npm-runtime.txt", texts.join(""));
await writeFile(
  "THIRD_PARTY_NOTICES.md",
  `# Third-party notices\n\nVFX Maker 0.4.0 uses pinned npm packages. The browser build includes PixiJS, React,\nZod, gifenc, fflate and their dependencies. Node tools use the official MCP SDK,\nCommander, Playwright Core and esbuild.\n\nThe exact installed runtime inventory, package integrity values and upstream\nrepository URLs are in [npm-runtime.json](docs/licenses/npm-runtime.json).\nUpstream license/notice texts are collected in [npm-runtime.txt](docs/licenses/npm-runtime.txt).\nRuntime inventory: ${inventory.length} installed packages, including the browser libraries.\nPlatform-specific optional packages may differ on another operating system.\n\nOriginal demonstration textures are retained from our own 0.3 assets. The 0.4\neditor, API and render routines are original implementation; third-party engine\nsource/assets have not been copied into them. Previous OSS research and Rust\ndependency notices remain under [legacy/rust](legacy/rust/THIRD_PARTY_NOTICES.md).\n\nThe project's own distribution license has not been selected; package metadata\nuses UNLICENSED. This does not change any upstream package's license.\n`,
);
process.stdout.write(`${inventory.length} runtime package notices collected\n`);
