#!/usr/bin/env node
import { Command } from "commander";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { VERSION, parseProject } from "../core/model.js";
import { Store } from "./store.js";
import { Service } from "./service.js";
import { browserPath } from "./driver.js";
import { serve } from "./server.js";
const cli = new Command()
  .name("vfx")
  .version(VERSION)
  .description("VFX Maker Studio, CLI and PixiJS export engine")
  .option("--root <directory>", "Project file root", process.cwd())
  .option("--json", "JSON output (default)");
const output = (v: unknown): void => {
  process.stdout.write(JSON.stringify(v, null, 2) + "\n");
};
const service = async () => new Service(await Store.open(cli.opts().root));
cli
  .command("presets")
  .description("List editable effect templates")
  .action(async () => output((await service()).presets()));
cli
  .command("schema")
  .argument(
    "[kind]",
    "project, layer, asset, pixels, export, creative, modifier or control",
    "project",
  )
  .action(async (kind) => {
    if (
      ![
        "project",
        "layer",
        "asset",
        "pixels",
        "export",
        "creative",
        "modifier",
        "control",
      ].includes(kind)
    )
      throw new Error("Unknown schema kind");
    output((await service()).schema(kind));
  });
cli
  .command("new <file>")
  .option("--preset <id>", "Template to copy", "red_magic_cross")
  .option("--seed <number>", "Random seed", Number)
  .action(async (file, opts) =>
    output(await (await service()).create(file, opts)),
  );
cli
  .command("inspect <file>")
  .alias("validate")
  .action(async (file) => output(await (await service()).store.read(file)));
cli
  .command("set <file>")
  .requiredOption("--set <json>", "Nested project or layer fields to merge")
  .option("--layer <id>", "Update a single layer")
  .option(
    "--if-match <revision>",
    "Expected revision (defaults to revision read under this command)",
  )
  .action(async (file, opts) => {
    const s = await service(),
      rev = opts.ifMatch ?? (await s.store.read(file)).revision;
    output(
      await (opts.layer
        ? s.updateLayer(file, rev, opts.layer, JSON.parse(opts.set))
        : s.update(file, rev, JSON.parse(opts.set))),
    );
  });
cli
  .command("add <file>")
  .requiredOption("--type <type>", "particles, path, ring, sprite or field")
  .requiredOption("--id <id>", "Unique layer ID")
  .option("--name <name>", "Layer display name")
  .option("--settings <json>", "Layer properties", "{}")
  .option("--if-match <revision>")
  .action(async (file, o) => {
    const s = await service(),
      rev = o.ifMatch ?? (await s.store.read(file)).revision;
    output(
      await s.addLayer(file, rev, {
        ...JSON.parse(o.settings),
        type: o.type,
        id: o.id,
        name: o.name ?? o.id,
      }),
    );
  });
cli
  .command("remove <file> <layer>")
  .option("--if-match <revision>")
  .action(async (file, id, o) => {
    const s = await service();
    output(
      await s.removeLayer(
        file,
        o.ifMatch ?? (await s.store.read(file)).revision,
        id,
      ),
    );
  });
cli
  .command("reorder <file>")
  .requiredOption("--ids <ids>", "Comma-separated IDs, bottom to top")
  .option("--if-match <revision>")
  .action(async (file, o) => {
    const s = await service();
    output(
      await s.reorder(
        file,
        o.ifMatch ?? (await s.store.read(file)).revision,
        o.ids.split(","),
      ),
    );
  });
cli
  .command("import-asset <file> <png>")
  .requiredOption("--id <id>")
  .option("--columns <number>", "Grid columns", Number, 1)
  .option("--rows <number>", "Grid rows", Number, 1)
  .option("--frames <number>", "Frame count", Number, 1)
  .option("--if-match <revision>")
  .action(async (file, png, o) => {
    const s = await service();
    output(
      await s.importAsset(
        file,
        o.ifMatch ?? (await s.store.read(file)).revision,
        png,
        { id: o.id, columns: o.columns, rows: o.rows, frames: o.frames },
      ),
    );
  });
cli
  .command("preview <file>")
  .option("--time <seconds>", "Frame time", Number, 0.35)
  .requiredOption("--out <file>", "New PNG file")
  .action(async (file, o) => {
    const s = await service(),
      dest = await s.store.path(o.out, false),
      result = await s.preview(file, o.time);
    await writeFile(dest, result.png, { flag: "wx" });
    output({ file: dest, revision: result.revision });
  });
cli
  .command("export <file>")
  .requiredOption("--out <directory>", "New output directory")
  .option(
    "--format <format>",
    "gif, spritesheet, sequence, godot or unity",
    "spritesheet",
  )
  .option("--fps <number>", "Override frame rate", Number)
  .option("--start <seconds>", "Export range start", Number)
  .option("--end <seconds>", "Export range end", Number)
  .option("--scale <number>", "Nearest-neighbor output scale, 0.125..8", Number)
  .option("--colors <number>", "Visible RGB limit, 0 or 2..256", Number)
  .option("--dither", "Ordered palette dithering")
  .option("--pixel-size <number>", "Output pixel block size, 1..16", Number)
  .option("--alpha-levels <number>", "Alpha limit, 0 or 2..256", Number)
  .option("--padding <number>", "Atlas padding, 0..16", Number)
  .option("--extrude", "Fill atlas padding with frame edge pixels")
  .option("--matte <hex>", "GIF background color")
  .option("--if-match <revision>")
  .option("--progress", "Write progress JSON to stderr")
  .action(async (file, o) => {
    const abort = new AbortController(),
      stop = () => abort.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      output(
        await (
          await service()
        ).export(
          file,
          o.out,
          {
            format: o.format,
            fps: o.fps,
            start: o.start,
            end: o.end,
            scale: o.scale,
            matte: o.matte,
            colors: o.colors,
            dither: o.dither,
            pixelSize: o.pixelSize,
            alphaLevels: o.alphaLevels,
            padding: o.padding,
            extrude: o.extrude,
          },
          o.ifMatch,
          abort.signal,
          o.progress
            ? (completed, total) =>
                process.stderr.write(
                  JSON.stringify({ completed, total }) + "\n",
                )
            : undefined,
        ),
      );
    } finally {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    }
  });
function pixelFlags(command: Command) {
  return command
    .option("--scale <number>", "Nearest-neighbor scale, 0.125..8", Number)
    .option("--colors <number>", "Visible RGB limit, 0 or 2..256", Number)
    .option("--dither", "Ordered palette dithering")
    .option("--pixel-size <number>", "Pixel block size, 1..16", Number)
    .option("--alpha-levels <number>", "Alpha limit, 0 or 2..256", Number);
}
const pixelSettings = (o: Record<string, unknown>) => ({
  scale: o.scale as number | undefined,
  colors: o.colors as number | undefined,
  dither: o.dither as boolean | undefined,
  pixelSize: o.pixelSize as number | undefined,
  alphaLevels: o.alphaLevels as number | undefined,
});
pixelFlags(
  cli
    .command("optimize <png>")
    .description("Optimize a static PNG locally without Chromium")
    .requiredOption("--out <png>", "New output file"),
).action(async (png, o) =>
  output(await (await service()).optimize(png, o.out, pixelSettings(o))),
);
pixelFlags(
  cli
    .command("optimize-asset <file> <id>")
    .description("Optimize an embedded texture, preserving its grid")
    .option("--if-match <revision>"),
).action(async (file, id, o) => {
  const s = await service();
  output(
    await s.optimizeAsset(
      file,
      o.ifMatch ?? (await s.store.read(file)).revision,
      id,
      pixelSettings(o),
    ),
  );
});
cli
  .command("resize <file>")
  .description("Scale a composition to fit, or change only its canvas")
  .requiredOption("--width <number>", "Canvas width, 16..512", Number)
  .requiredOption("--height <number>", "Canvas height, 16..512", Number)
  .option("--mode <mode>", "scale or canvas", "scale")
  .option("--if-match <revision>")
  .action(async (file, o) => {
    const s = await service();
    output(
      await s.resize(
        file,
        o.ifMatch ?? (await s.store.read(file)).revision,
        o.width,
        o.height,
        o.mode,
      ),
    );
  });
cli
  .command("recolor <file>")
  .description("Rotate layer gradient/tint hues together")
  .requiredOption("--hue <degrees>", "Hue rotation, -360..360", Number)
  .option("--layers <ids>", "Comma-separated layer IDs; defaults to all")
  .option("--include-locked", "Also recolor locked layers")
  .option("--if-match <revision>")
  .action(async (file, o) => {
    const s = await service();
    output(
      await s.recolor(
        file,
        o.ifMatch ?? (await s.store.read(file)).revision,
        o.hue,
        o.includeLocked,
        o.layers?.split(","),
      ),
    );
  });
cli
  .command("group <file>")
  .description("Create a named selection group without reordering layers")
  .requiredOption("--id <id>", "Unique group ID")
  .requiredOption("--name <name>", "Group name")
  .requiredOption("--layers <ids>", "Comma-separated existing layer IDs")
  .option("--if-match <revision>")
  .action(async (file, o) => {
    const s = await service();
    output(
      await s.group(
        file,
        o.ifMatch ?? (await s.store.read(file)).revision,
        o.id,
        o.name,
        o.layers.split(","),
      ),
    );
  });
cli
  .command("transform <file>")
  .description("Transform a selection around its mean anchor")
  .requiredOption("--layers <ids>", "Comma-separated layer IDs")
  .option("--x <number>", "Horizontal offset", Number)
  .option("--y <number>", "Vertical offset", Number)
  .option("--rotation <degrees>", "Rotation offset", Number)
  .option("--scale <number>", "Uniform scale factor", Number)
  .option("--include-locked", "Also transform locked layers")
  .option("--if-match <revision>")
  .action(async (file, o) => {
    const s = await service();
    output(
      await s.transform(
        file,
        o.ifMatch ?? (await s.store.read(file)).revision,
        o.layers.split(","),
        o,
      ),
    );
  });
cli
  .command("keyframe <file> <layer> <channel>")
  .description("Insert or replace a normalized curve key")
  .requiredOption("--time <number>", "Normalized layer time, 0..1", Number)
  .requiredOption("--value <number>", "Curve value", Number)
  .option("--ease <mode>", "linear, smooth or hold", "linear")
  .option("--if-match <revision>")
  .action(async (file, id, channel, o) => {
    const s = await service();
    output(
      await s.keyframe(
        file,
        o.ifMatch ?? (await s.store.read(file)).revision,
        id,
        channel,
        o.time,
        o.value,
        o.ease,
      ),
    );
  });
cli
  .command("backups <file>")
  .description("List up to five retained versions before disk edits")
  .action(async (file) => output(await (await service()).store.backups(file)));
cli
  .command("controls <file>")
  .description(
    "Inspect controls, variants, modifiers and valid binding targets",
  )
  .action(async (file) => output(await (await service()).creative(file)));
cli
  .command("creative <file>")
  .description("Apply a validated creative operation; use vfx schema creative")
  .requiredOption("--set <json>", "Operation JSON")
  .option("--if-match <revision>")
  .action(async (file, o) => {
    const s = await service();
    output(
      await s.editCreative(
        file,
        o.ifMatch ?? (await s.store.read(file)).revision,
        JSON.parse(o.set),
      ),
    );
  });
cli
  .command("control <file> <id> <value>")
  .description("Set an exposed effect control without changing its base fields")
  .option("--if-match <revision>")
  .action(async (file, id, value, o) => {
    const s = await service();
    output(
      await s.editCreative(
        file,
        o.ifMatch ?? (await s.store.read(file)).revision,
        { action: "set_control", id, value: Number(value) },
      ),
    );
  });
cli
  .command("component-save <file>")
  .description(
    "Save selected layers and their assets/controls as a portable component",
  )
  .requiredOption("--layers <ids>", "Comma-separated layer IDs")
  .requiredOption("--name <name>")
  .requiredOption("--out <file>", "New .vfx-component.json file")
  .option("--if-match <revision>")
  .action(async (file, o) => {
    const s = await service();
    output(
      await s.saveComponent(
        file,
        o.out,
        o.layers.split(","),
        o.name,
        o.ifMatch ?? (await s.store.read(file)).revision,
      ),
    );
  });
cli
  .command("component-insert <file> <component>")
  .description("Insert a component, remapping all IDs and asset references")
  .option("--x <number>", "Center X", Number)
  .option("--y <number>", "Center Y", Number)
  .option("--if-match <revision>")
  .action(async (file, component, o) => {
    const s = await service();
    output(
      await s.insertComponent(
        file,
        o.ifMatch ?? (await s.store.read(file)).revision,
        component,
        o.x,
        o.y,
      ),
    );
  });
cli
  .command("export-variants <file>")
  .description(
    "Render 1..8 saved variants to a new folder in one browser session",
  )
  .requiredOption("--ids <ids>", "Comma-separated variant IDs")
  .requiredOption("--out <directory>")
  .option(
    "--format <format>",
    "gif, spritesheet, sequence, godot or unity",
    "gif",
  )
  .option("--scale <number>", "Output scale", Number)
  .option("--colors <number>", "Palette color limit", Number)
  .option("--if-match <revision>")
  .option("--progress")
  .action(async (file, o) => {
    const s = await service(),
      snapshot = await s.store.read(file),
      abort = new AbortController(),
      stop = () => abort.abort();
    if (o.ifMatch && o.ifMatch !== snapshot.revision)
      throw Error("Revision conflict");
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      output(
        await s.exportVariants(
          snapshot.project,
          snapshot.revision,
          o.out,
          o.ids.split(","),
          { format: o.format, scale: o.scale, colors: o.colors },
          abort.signal,
          o.progress
            ? (completed, total) =>
                process.stderr.write(
                  JSON.stringify({ completed, total }) + "\n",
                )
            : undefined,
        ),
      );
    } finally {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    }
  });
cli
  .command("restore <file> <backup>")
  .description("Restore a backup, backing up the current file first")
  .option("--if-match <revision>")
  .action(async (file, id, o) => {
    const s = await service();
    output(
      await s.store.restore(
        file,
        o.ifMatch ?? (await s.store.read(file)).revision,
        id,
      ),
    );
  });
cli
  .command("build <source>")
  .description(
    "Execute a trusted TypeScript effect module and save its exported project",
  )
  .requiredOption("--out <file>", "New project JSON file")
  .action(async (source, opts) => {
    const s = await service(),
      path = await s.store.path(source),
      api = fileURLToPath(new URL("./core.js", import.meta.url));
    const result = await build({
      entryPoints: [path],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      write: false,
      plugins: [
        {
          name: "local-vfx-api",
          setup(b) {
            b.onResolve({ filter: /^vfx-maker$/ }, () => ({ path: api }));
          },
        },
      ],
    });
    const mod = await import(
      "data:text/javascript;base64," +
        Buffer.from(result.outputFiles[0].text).toString("base64")
    );
    const value =
      typeof mod.default === "function" ? await mod.default() : mod.default;
    output(await s.store.create(opts.out, parseProject(value)));
  });
cli
  .command("studio [file]")
  .description("Open the local React + PixiJS editor")
  .option("--port <port>", "Loopback port", Number, 4173)
  .option("--open", "Launch the system browser")
  .action(async (file, opts) => {
    if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535)
      throw new Error("Port must be 0..65535");
    const studioService = await service();
    const project = file
      ? (await studioService.store.read(file)).project
      : undefined;
    const server = await serve({
      port: opts.port,
      project,
      document: file ? { store: studioService.store, file } : undefined,
    });
    const url = server.url + (project ? "/#project=" + server.token : "/");
    output({
      studio: url,
      note: file
        ? "Save writes the selected project with revision checks and backups. Ctrl+C stops this server."
        : "Open or create a project in Studio. Ctrl+C stops this server.",
    });
    if (opts.open) {
      const command =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "explorer.exe"
            : "xdg-open";
      const p = spawn(command, [url], { stdio: "ignore", detached: true });
      p.on("error", (e) =>
        process.stderr.write(`Could not open browser: ${e.message}\n`),
      );
      p.unref();
    }
    const stop = () => {
      void server.close().then(() => process.exit(0));
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
cli
  .command("doctor")
  .description("Check Node, browser discovery and optional actual rendering")
  .option("--render", "Render an actual PixiJS frame")
  .action(async (opts) => {
    const browser = browserPath();
    const result: Record<string, unknown> = {
      version: VERSION,
      node: process.version,
      browser: browser ?? null,
      editor: "React 19 + PixiJS 8",
      root: resolve(cli.opts().root),
    };
    if (opts.render) {
      const p = (await import("../core/presets.js")).getPreset();
      const r = await (await import("./driver.js")).render(p, { time: 0.35 });
      result.renderedBytes = r["preview.png"].length;
    }
    output(result);
  });
cli
  .command("browser")
  .argument("<action>", "install")
  .description(
    "Install Playwright Chromium if system Chrome/Chromium is unavailable",
  )
  .action(async (action) => {
    if (action !== "install") throw new Error("Use vfx browser install");
    const path = fileURLToPath(
      new URL("cli.js", import.meta.resolve("playwright-core")),
    );
    const child = spawn(process.execPath, [path, "install", "chromium"], {
      stdio: "inherit",
    });
    const code = await new Promise<number | null>((res, rej) => {
      child.once("error", rej);
      child.once("exit", res);
    });
    if (code !== 0)
      throw new Error(`Chromium installation exited with ${code}`);
  });
try {
  await cli.parseAsync();
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  process.stderr.write(JSON.stringify({ error: message }) + "\n");
  process.exitCode = e instanceof Error && e.name === "AbortError" ? 130 : 1;
}
