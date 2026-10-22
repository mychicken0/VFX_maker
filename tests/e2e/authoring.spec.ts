import { test, expect, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";
import {
  defineEffect,
  path,
  ring,
  curve,
  colors,
  getPreset,
  parseProject,
  type Project,
} from "../../src/core/index.js";
import { Store } from "../../src/node/store.js";
import { serve } from "../../src/node/server.js";

const button = (p: Page, name: string) =>
  p.getByRole("button", { name, exact: true });
async function start(p: Page) {
  await p.goto("/");
  await button(p, "Pause").click();
  await p.getByLabel("Playhead", { exact: true }).fill("0.4");
  await expect(p.locator(".pixi-host canvas")).toBeVisible();
}
async function snapshot(p: Page): Promise<Project> {
  const wait = p.waitForEvent("download");
  await button(p, "Project menu").click();
  await p
    .getByRole("menuitem", { name: "Download project", exact: true })
    .click();
  return JSON.parse(await readFile((await (await wait).path())!, "utf8"));
}
async function field(p: Page, name: string, value: string) {
  const input = p.getByLabel(name, { exact: true });
  await input.fill(value);
  await input.blur();
}
async function drag(
  p: Page,
  selector: ReturnType<Page["locator"]>,
  dx: number,
  dy: number,
) {
  const b = (await selector.boundingBox())!;
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await p.mouse.down();
  await p.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, {
    steps: 5,
  });
  await p.mouse.up();
}

test("selects, groups, transforms and duplicates multiple layers with a single undo", async ({
  page,
}) => {
  await start(page);
  await page
    .locator(".layer-select")
    .filter({ hasText: "First slash" })
    .click();
  await page
    .locator(".layer-select")
    .filter({ hasText: "Second slash" })
    .click({ modifiers: ["Control"] });
  await expect(page.locator(".batch-panel")).toContainText("2 layers");
  const before = await snapshot(page);
  await button(page, "Group selection").click();
  const grouped = await snapshot(page);
  expect(grouped.groups).toHaveLength(1);
  expect(grouped.layers).toEqual(before.layers);
  await field(page, "Selection move X", "7");
  await field(page, "Selection rotation", "30");
  await field(page, "Selection scale", "1.25");
  await button(page, "Apply transform").click();
  const changed = await snapshot(page);
  for (const id of ["cut-a", "cut-b"])
    expect(changed.layers.find((l) => l.id === id)?.scale).toBe(1.25);
  expect(
    changed.layers.filter((l) => !["cut-a", "cut-b"].includes(l.id)),
  ).toEqual(before.layers.filter((l) => !["cut-a", "cut-b"].includes(l.id)));
  await button(page, "Undo").click();
  expect((await snapshot(page)).layers).toEqual(before.layers);
  await page.keyboard.press("Control+d");
  const duplicate = await snapshot(page);
  expect(duplicate.layers).toHaveLength(before.layers.length + 2);
  expect(duplicate.groups).toHaveLength(2);
  await button(page, "Undo").click();
  expect((await snapshot(page)).groups).toHaveLength(1);
});

test("adds and drags timeline keys, cancels drafts, loops a range and renders onion frames", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  await page
    .locator(".layer-select")
    .filter({ hasText: "First slash" })
    .click();
  await button(page, "Keyframes").click();
  const graph = page.getByRole("img", { name: "Timeline keyframe graph" }),
    b = (await graph.boundingBox())!;
  await graph.dblclick({ position: { x: b.width * 0.3, y: 32 } });
  const inserted = await snapshot(page),
    keys = inserted.layers.find((l) => l.id === "cut-a")!.motion.x;
  expect(keys).toHaveLength(3);
  const key = page.getByLabel("Timeline key 2", { exact: true });
  await drag(page, key, 30, -8);
  const changed = await snapshot(page);
  expect(changed.layers.find((l) => l.id === "cut-a")!.motion.x).not.toEqual(
    keys,
  );
  const kb = (await key.boundingBox())!;
  await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2);
  await page.mouse.down();
  await page.mouse.move(kb.x + 20, kb.y + 10);
  await key.dispatchEvent("pointercancel");
  await page.mouse.up();
  expect((await snapshot(page)).layers).toEqual(changed.layers);
  await button(page, "Loop range").click();
  await field(page, "Range start", "0.2");
  await field(page, "Range end", "0.5");
  await page.getByLabel("Playhead", { exact: true }).fill("0.4");
  await button(page, "Play").click();
  await expect
    .poll(async () =>
      Number(await page.getByLabel("Playhead", { exact: true }).inputValue()),
    )
    .toBeLessThan(0.4);
  await button(page, "Pause").click();
  await button(page, "Onion skin").click();
  await expect(page.locator(".onion-skin canvas")).toHaveCount(2);
  await expect
    .poll(() =>
      page
        .locator(".onion-skin canvas")
        .first()
        .evaluate((c: HTMLCanvasElement) => c.width),
    )
    .toBe(128);
  await expect
    .poll(async () => {
      const url = await page
        .locator(".onion-skin canvas")
        .first()
        .evaluate((c: HTMLCanvasElement) => c.toDataURL());
      return PNG.sync
        .read(Buffer.from(url.split(",")[1], "base64"))
        .data.some((v, i) => i % 4 === 3 && v > 0);
    })
    .toBe(true);
  expect(errors).toEqual([]);
  const project = await snapshot(page);
  await page.goto("/render.html");
  await page.waitForFunction(() => !!window.vfx);
  const output = await page.evaluate(
    (p) => window.vfx.export(p, { format: "spritesheet", fps: 10 }),
    project,
  );
  const meta = JSON.parse(
    Buffer.from(output["metadata.json"], "base64").toString(),
  );
  expect(meta.frames).toHaveLength(12);
});

test("draws a freehand stroke, edits Bezier tangents and a layer mask, and supports undo", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  const before = await snapshot(page);
  await button(page, "Freehand stroke").click();
  const surface = page.getByLabel("Freehand drawing surface"),
    b = (await surface.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.25, b.y + b.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.25, {
    steps: 8,
  });
  await page.mouse.move(b.x + b.width * 0.75, b.y + b.height * 0.45, {
    steps: 8,
  });
  await page.mouse.up();
  const drawn = await snapshot(page),
    stroke = drawn.layers.at(-1)!;
  expect(drawn.layers).toHaveLength(before.layers.length + 1);
  if (stroke.type !== "path") throw Error("Expected path");
  expect(stroke.points.length).toBeGreaterThanOrEqual(3);
  await button(page, "Bezier handles").click();
  await expect(
    page.getByLabel("Bezier out handle", { exact: true }),
  ).toBeVisible();
  await drag(
    page,
    page.getByLabel("Bezier out handle", { exact: true }),
    12,
    -18,
  );
  const curved = await snapshot(page);
  expect((curved.layers.at(-1) as typeof stroke).handles).toBeDefined();
  await page.getByText("Layer mask", { exact: true }).click();
  await page.getByLabel("Enable layer mask", { exact: true }).check();
  await button(page, "Mask edit").click();
  await drag(
    page,
    page.getByLabel("Drag mask size", { exact: true }),
    -15,
    -15,
  );
  const masked = await snapshot(page);
  expect(masked.layers.at(-1)?.mask?.width).toBeLessThan(64);
  await button(page, "Undo").click();
  expect((await snapshot(page)).layers.at(-1)?.mask?.width).toBe(64);
  expect(errors).toEqual([]);
});

test("imports and positions a preview reference which never changes exported pixels or portable source", async ({
  page,
}) => {
  await start(page);
  const before = await snapshot(page),
    image = getPreset("flipbook_burst").assets[0];
  await button(page, "reference").click();
  await page.getByLabel("Reference PNG", { exact: true }).setInputFiles({
    name: "character.png",
    mimeType: "image/png",
    buffer: Buffer.from(image.data.split(",")[1], "base64"),
  });
  await expect(page.locator(".reference-plane img")).toBeVisible();
  await field(page, "Reference X", "45");
  await field(page, "Reference scale", "1.5");
  await button(page, "Reference move").click();
  await drag(
    page,
    page.getByLabel("Drag reference position", { exact: true }),
    30,
    0,
  );
  const p = await snapshot(page);
  expect(p.editor.reference?.position.x).toBe(55);
  expect(p.editor.reference?.scale).toBe(1.5);
  expect(p.layers).toEqual(before.layers);
  await page.goto("/render.html");
  await page.waitForFunction(() => !!window.vfx);
  const result = await page.evaluate(
    async ({ p, before }) => ({
      a: await window.vfx.preview(p, 0.35),
      b: await window.vfx.preview(before, 0.35),
      files: await window.vfx.export(p, { format: "spritesheet" }),
    }),
    { p, before },
  );
  expect(result.a).toBe(result.b);
  const portable = JSON.parse(
    Buffer.from(result.files["effect.vfx.json"], "base64").toString(),
  );
  expect(portable.editor.reference).toBeUndefined();
  expect(portable.layers).toEqual(p.layers);
});

test("Save writes the connected disk file, restores backups, remembers Save As and recovers unsaved work", async ({
  page,
}) => {
  const dir = await mkdtemp(join(tmpdir(), "vfx-studio-doc-")),
    store = await Store.open(dir),
    created = await store.create("original.vfx.json", getPreset());
  const server = await serve({
    webRoot: resolve("dist/web"),
    project: created.project,
    document: { store, file: "original.vfx.json" },
  });
  try {
    await page.goto(server.url + "/#project=" + server.token);
    await expect(page.locator(".document-status")).toContainText(
      "original.vfx.json",
    );
    await field(page, "Effect name", "Saved edit");
    await page.keyboard.press("Control+s");
    await expect
      .poll(async () => (await store.read("original.vfx.json")).project.name)
      .toBe("Saved edit");
    await button(page, "Project menu").click();
    await page
      .getByRole("menuitem", { name: "File backups…", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /Restore this version/ })
      .first()
      .click();
    await expect(page.getByLabel("Effect name", { exact: true })).toHaveValue(
      created.project.name,
    );
    await page.keyboard.press("Control+Shift+s");
    await field(page, "Project filename", "copy.vfx.json");
    await button(page, "Save new file").click();
    await expect(page.locator(".document-status")).toContainText(
      "copy.vfx.json",
    );
    await field(page, "Effect name", "Unsaved recovery");
    expect((await snapshot(page)).name).toBe("Unsaved recovery");
    await expect(page.locator(".document-status")).toContainText(
      "Unsaved changes",
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("vfx-maker.recovery") ?? "{}")
              .dirty,
        ),
      )
      .toBe(true);
    const context = page.context();
    await page.close({ runBeforeUnload: false });
    page = await context.newPage();
    await page.goto(server.url + "/#project=" + server.token);
    await expect(
      page.getByRole("dialog", { name: "Recover unsaved work" }),
    ).toBeVisible();
    await button(page, "Recover unsaved changes").click();
    await expect(page.getByLabel("Effect name", { exact: true })).toHaveValue(
      "Unsaved recovery",
    );
    expect((await store.read("copy.vfx.json")).project.name).toBe(
      created.project.name,
    );
    await page.keyboard.press("Control+s");
    await expect
      .poll(async () => (await store.read("copy.vfx.json")).project.name)
      .toBe("Unsaved recovery");
    expect((await store.read("original.vfx.json")).project.name).toBe(
      created.project.name,
    );
    const external = await store.read("copy.vfx.json");
    await store.edit("copy.vfx.json", external.revision, (p) => ({
      ...p,
      name: "External edit",
    }));
    await field(page, "Effect name", "Should not overwrite");
    await page.keyboard.press("Control+s");
    await expect(page.getByRole("status")).toContainText("Revision conflict");
    expect((await store.read("copy.vfx.json")).project.name).toBe(
      "External edit",
    );
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("timeline keys remain reachable in a short window and focus mode restores the preview", async ({
  page,
}) => {
  await start(page);
  await page
    .locator(".layer-select")
    .filter({ hasText: "First slash" })
    .click();
  await page.setViewportSize({ width: 640, height: 360 });
  await button(page, "Keyframes").click();
  await expect(page.locator(".viewport")).toBeHidden();
  const graph = page.getByRole("img", { name: "Timeline keyframe graph" });
  await graph.scrollIntoViewIfNeeded();
  const b = (await graph.boundingBox())!;
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.y + b.height).toBeLessThanOrEqual(360);
  await button(page, "Restore canvas").click();
  await expect(page.locator(".viewport")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 700 });
  await button(page, "Focus timeline").click();
  await button(page, "Loop range").click();
  await field(page, "Range end", "0.8");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBe(390);
  await graph.scrollIntoViewIfNeeded();
  await expect(page.getByLabel("Range end", { exact: true })).toHaveValue(
    "0.8",
  );
});

test("native Save remembers a real browser file handle across reloads and protects external edits", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async () => {
        const directory = await navigator.storage.getDirectory();
        return directory.getFileHandle("native.vfx.json", { create: true });
      },
    });
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: async () => [
        await (
          await navigator.storage.getDirectory()
        ).getFileHandle("native.vfx.json"),
      ],
    });
  });
  await start(page);
  await field(page, "Effect name", "Native save");
  await button(page, "Save project").click();
  const disk = () =>
    page.evaluate(async () => {
      const d = await navigator.storage.getDirectory();
      const h = await d
        .getFileHandle("native.vfx.json")
        .catch((e: DOMException) => {
          if (e.name === "NotFoundError") return null;
          throw e;
        });
      if (!h) return {};
      return JSON.parse((await (await h.getFile()).text()) || "{}");
    });
  await expect.poll(async () => (await disk()).name).toBe("Native save");
  await expect(page.locator(".document-status")).toContainText(
    "native.vfx.json",
  );
  await page.reload();
  await expect(page.locator(".document-status")).toContainText(
    "native.vfx.json",
  );
  await field(page, "Effect name", "Native second");
  await page.keyboard.press("Control+s");
  await expect.poll(async () => (await disk()).name).toBe("Native second");
  await page.evaluate(async () => {
    const d = await navigator.storage.getDirectory(),
      h = await d.getFileHandle("native.vfx.json"),
      p = JSON.parse(await (await h.getFile()).text());
    p.name = "External";
    const w = await h.createWritable();
    await w.write(JSON.stringify(p));
    await w.close();
  });
  await field(page, "Effect name", "Conflict");
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("status")).toContainText("Revision conflict");
  expect((await disk()).name).toBe("External");
  const id = await page.evaluate(() =>
    localStorage.getItem("vfx-maker.active-file"),
  );
  await button(page, "Open").click();
  await expect(page.getByLabel("Effect name", { exact: true })).toHaveValue(
    "External",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("vfx-maker.active-file")),
  ).toBe(id);
  await field(page, "Effect name", "After reopen");
  await page.keyboard.press("Control+s");
  await expect.poll(async () => (await disk()).name).toBe("After reopen");
  await button(page, "Project menu").click();
  await page
    .getByRole("menuitem", { name: "File backups…", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: /Restore this version/ }),
  ).toHaveCount(2);
  await button(page, "Close dialog").click();
  await page.addInitScript(() => {
    Object.defineProperty(FileSystemHandle.prototype, "queryPermission", {
      configurable: true,
      value: async () => "prompt",
    });
    Object.defineProperty(FileSystemHandle.prototype, "requestPermission", {
      configurable: true,
      value: async () => "granted",
    });
  });
  await page.reload();
  await expect(page.locator(".document-status")).toContainText(
    "native.vfx.json",
  );
  await field(page, "Effect name", "After permission renewal");
  await page.keyboard.press("Control+s");
  await expect
    .poll(async () => (await disk()).name)
    .toBe("After permission renewal");
  await page.addInitScript(() => {
    Object.defineProperty(FileSystemHandle.prototype, "queryPermission", {
      configurable: true,
      value: async () => "prompt",
    });
    const key = "vfx-maker.0.4.autosave",
      p = JSON.parse(localStorage.getItem(key)!);
    p.name = "Other document";
    localStorage.setItem(key, JSON.stringify(p));
    localStorage.setItem(
      "vfx-maker.recovery",
      JSON.stringify({ id: "different-document", dirty: true }),
    );
  });
  await page.reload();
  await expect(page.getByLabel("Effect name", { exact: true })).toHaveValue(
    "Other document",
  );
  await expect(page.locator(".document-status")).toHaveCount(0);
  expect((await disk()).name).toBe("After permission renewal");
});

test("Bezier strokes and each mask type alter actual rendered RGBA and survive export", async ({
  page,
}) => {
  await page.goto("/render.html");
  await page.waitForFunction(() => !!window.vfx);
  const p = defineEffect({
    canvas: { width: 64, height: 64 },
    duration: 0.2,
    fps: 10,
    layers: [
      path({
        id: "p",
        name: "Arc",
        position: { x: 32, y: 32 },
        points: [
          { x: -20, y: 0 },
          { x: 20, y: 0 },
        ],
        width: curve(4),
        opacity: curve(1),
        draw: curve(1),
        colors: colors("#ff0000"),
        blend: "normal",
        handles: [
          { in: { x: 0, y: 0 }, out: { x: 0, y: -24 } },
          { in: { x: 0, y: -24 }, out: { x: 0, y: 0 } },
        ],
      }),
    ],
  });
  const arc = PNG.sync.read(
    Buffer.from(
      await page.evaluate((p) => window.vfx.preview(p, 0.1), p),
      "base64",
    ),
  );
  const alpha = (png: PNG, x: number, y: number) =>
    png.data[(y * png.width + x) * 4 + 3];
  expect(alpha(arc, 32, 14)).toBeGreaterThan(0);
  expect(alpha(arc, 32, 32)).toBe(0);
  const fill = ring({
    id: "disk",
    name: "Disk",
    position: { x: 32, y: 32 },
    radius: curve(16),
    width: curve(32),
    opacity: curve(1),
    colors: colors("#ff0000"),
    blend: "normal",
  });
  for (const shape of ["rectangle", "ellipse", "polygon"] as const) {
    const q = parseProject({
      ...p,
      layers: [
        {
          ...fill,
          mask: {
            shape,
            position: { x: 0, y: 0 },
            width: 16,
            height: 16,
            points: [
              { x: -8, y: -8 },
              { x: 8, y: -8 },
              { x: 0, y: 8 },
            ],
          },
        },
      ],
    });
    const png = PNG.sync.read(
      Buffer.from(
        await page.evaluate((p) => window.vfx.preview(p, 0.1), q),
        "base64",
      ),
    );
    expect(alpha(png, 32, 32), shape).toBe(255);
    expect(alpha(png, 44, 32), shape).toBe(0);
    const out = await page.evaluate(
      (p) => window.vfx.export(p, { format: "sequence" }),
      q,
    );
    const first = Object.keys(out).find(
      (k) => k.startsWith("frames/") && k.endsWith(".png"),
    )!;
    expect(PNG.sync.read(Buffer.from(out[first], "base64")).data).toEqual(
      png.data,
    );
  }
});
