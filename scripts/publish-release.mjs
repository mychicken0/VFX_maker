// Runs in the manually dispatched release workflow, with narrowly scoped permissions.
// Packages must come from successful CI for exactly GITHUB_SHA; no local upload needed.
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
const mode = process.argv[2],
  repository = process.env.GITHUB_REPOSITORY,
  sha = process.env.GITHUB_SHA,
  runId = process.env.VFX_CI_RUN_ID,
  version = JSON.parse(await readFile("package.json", "utf8")).version;
if (
  !["prepare", "publish"].includes(mode) ||
  !/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") ||
  !/^[a-f0-9]{40}$/.test(sha ?? "") ||
  !/^\d+$/.test(runId ?? "") ||
  !/^\d+\.\d+\.\d+$/.test(version)
)
  throw Error(
    "Use the release workflow with a numeric CI run and semantic package version.",
  );
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" }),
  run = JSON.parse(gh("api", `repos/${repository}/actions/runs/${runId}`));
if (
  run.conclusion !== "success" ||
  run.head_sha !== sha ||
  run.repository?.full_name !== repository ||
  run.path !== ".github/workflows/ci.yml" ||
  run.event !== "push" ||
  run.head_branch !== "main"
)
  throw Error(
    "Release requires successful main-branch CI for this exact commit.",
  );
const names = [
    `vfx-maker-${version}-studio.zip`,
    `vfx-maker-${version}.tgz`,
    `vfx-maker-source-${version}.tar.gz`,
  ],
  sumsName = `SHA256SUMS-${version}.txt`,
  tag = `v${version}`;
if (mode === "prepare") {
  await mkdir("release");
  gh(
    "run",
    "download",
    runId,
    "--repo",
    repository,
    "--name",
    `vfx-maker-${version}`,
    "--dir",
    "release",
  );
  for (const name of names.slice(0, 2)) {
    if (!(await stat(`release/${name}`)).isFile())
      throw Error(`CI package missing: ${name}`);
  }
  const [expected] = (await readFile(`release/${names[0]}.sha256`, "utf8"))
      .trim()
      .split(/\s+/),
    actual = createHash("sha256")
      .update(await readFile(`release/${names[0]}`))
      .digest("hex");
  if (actual !== expected) throw Error("CI Studio ZIP checksum mismatch");
  execFileSync("git", [
    "archive",
    "--format=tar.gz",
    `--prefix=vfx-maker-${version}/`,
    `--output=release/${names[2]}`,
    sha,
  ]);
  const sums = [];
  for (const name of names)
    sums.push(
      `${createHash("sha256")
        .update(await readFile(`release/${name}`))
        .digest("hex")}  ${name}`,
    );
  await writeFile(`release/${sumsName}`, sums.join("\n") + "\n");
  const notes = (await readFile(`docs/RELEASE_${version}.md`, "utf8")).replace(
    /\]\((?!https?:|#)([^)]+)\)/g,
    (_, path) => `](https://github.com/${repository}/blob/${tag}/docs/${path})`,
  );
  await writeFile(
    "release/notes.md",
    `${notes}\n\nVerified by [exact-commit CI](${run.html_url}).\n\nDownload the Studio ZIP, install Node.js 24 LTS once, then open its Start file. CLI/MCP users can install the attached npm archive; the source archive and SHA-256 sums are included. Linux/Chromium was tested; Windows/macOS launch scripts are unverified on those operating systems.\n`,
  );
  console.log(`Prepared CI-verified ${tag} for ${sha}`);
} else {
  // Verify prepared payloads again before publication; never replace an existing release.
  const lines = (await readFile(`release/${sumsName}`, "utf8"))
    .trim()
    .split("\n");
  if (lines.length !== names.length)
    throw Error("Unexpected checksum manifest");
  for (const [i, name] of names.entries()) {
    const hash = createHash("sha256")
      .update(await readFile(`release/${name}`))
      .digest("hex");
    if (lines[i] !== `${hash}  ${name}`)
      throw Error(`Release checksum mismatch: ${name}`);
  }
  console.log(
    gh(
      "release",
      "create",
      tag,
      ...[...names, sumsName].map((n) => `release/${n}`),
      "--repo",
      repository,
      "--target",
      sha,
      "--title",
      `VFX Maker ${version} — canvas-first, AI-native`,
      "--notes-file",
      "release/notes.md",
      "--latest",
    ),
  );
}
