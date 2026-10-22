import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";
import {
  defineEffect,
  field,
  ring,
  particles,
  curve,
  colors,
  modifierSchema,
  getPreset,
  captureVariant,
  setControl,
  type Project,
} from "../../src/core/index.js";
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
async function snapshot(page: Page): Promise<Project> {
  const pending = page.waitForEvent("download");
  await button(page, "Project menu").click();
  await page
    .getByRole("menuitem", { name: "Download project", exact: true })
    .click();
  return JSON.parse(await readFile((await (await pending).path())!, "utf8"));
}
async function start(page: Page) {
  await page.goto("/");
  await button(page, "Pause").click();
  await page.getByLabel("Playhead", { exact: true }).fill("0.3");
  await expect(page.locator(".pixi-host canvas")).toBeVisible();
}
const visible = (base64: string) => {
  const png = PNG.sync.read(Buffer.from(base64, "base64"));
  let count = 0;
  for (let i = 3; i < png.data.length; i += 4) if (png.data[i]) count++;
  return count;
};

test("procedural patterns and ordered modifiers compile and render reproducibly", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /shader|WebGL|uniform/i.test(m.text()))
      errors.push(m.text());
  });
  await page.goto("/render.html");
  await page.waitForFunction(() => !!window.vfx);
  for (const pattern of [
    "noise",
    "cells",
    "radial",
    "box",
    "stripes",
  ] as const) {
    const p = defineEffect({
      duration: 1,
      layers: [
        field({
          id: "texture",
          name: "Texture",
          pattern,
          cutoff: curve(0.2),
          opacity: curve(1),
        }),
      ],
    });
    const a = await page.evaluate((p) => window.vfx.preview(p, 0.3), p);
    expect(visible(a), pattern).toBeGreaterThan(100);
    await page.evaluate((p) => window.vfx.preview(p, 0.7), p);
    expect(
      await page.evaluate((p) => window.vfx.preview(p, 0.3), p),
      pattern,
    ).toBe(a);
  }
  const base = defineEffect({
    duration: 1,
    layers: [
      ring({
        id: "ring",
        name: "Ring",
        radius: curve(24),
        width: curve(8),
        colors: colors("#ffffff"),
        opacity: curve(1),
      }),
    ],
  });
  const original = await page.evaluate((p) => window.vfx.preview(p, 0.2), base);
  for (const type of [
    "outline",
    "pixelate",
    "color-replace",
    "ramp",
    "shockwave",
    "noise-warp",
    "dissolve",
  ] as const) {
    const p = structuredClone(base);
    p.layers[0].modifiers = [modifierSchema.parse({ id: "modifier", type })];
    const a = await page.evaluate((p) => window.vfx.preview(p, 0.2), p);
    expect(visible(a), type).toBeGreaterThan(0);
    expect(a, type).not.toBe(original);
    p.layers[0].modifiers[0].enabled = false;
    expect(
      await page.evaluate((p) => window.vfx.preview(p, 0.2), p),
      `${type} bypass`,
    ).toBe(original);
  }
  const gone = structuredClone(base);
  gone.layers[0].modifiers = [
    modifierSchema.parse({ id: "gone", type: "dissolve", amount: 1 }),
  ];
  expect(
    visible(await page.evaluate((p) => window.vfx.preview(p, 0.2), gone)),
  ).toBe(0);
  expect(errors).toEqual([]);
});

test("modifier order changes actual colors and sampled trails add reproducible pixels", async ({
  page,
}) => {
  await page.goto("/render.html");
  await page.waitForFunction(() => !!window.vfx);
  const ramp = modifierSchema.parse({
      id: "ramp",
      type: "ramp",
      high: "#ff0000",
    }),
    replace = modifierSchema.parse({
      id: "replace",
      type: "color-replace",
      from: "#ff0000",
      to: "#00ff00",
      tolerance: 0.01,
    });
  const p = defineEffect({
    duration: 1,
    layers: [
      ring({
        id: "ring",
        name: "Ring",
        radius: curve(24),
        width: curve(8),
        colors: colors("#ffffff"),
        opacity: curve(1),
        blend: "normal",
        modifiers: [ramp, replace],
      }),
    ],
  });
  const first = PNG.sync.read(
    Buffer.from(
      await page.evaluate((p) => window.vfx.preview(p, 0.2), p),
      "base64",
    ),
  );
  p.layers[0].modifiers.reverse();
  const second = PNG.sync.read(
    Buffer.from(
      await page.evaluate((p) => window.vfx.preview(p, 0.2), p),
      "base64",
    ),
  );
  const offset = (64 * 128 + 88) * 4;
  expect([...first.data.subarray(offset, offset + 4)]).toEqual([
    0, 255, 0, 255,
  ]);
  expect([...second.data.subarray(offset, offset + 4)]).toEqual([
    255, 0, 0, 255,
  ]);
  const trail = defineEffect({
    duration: 1,
    layers: [
      particles({
        id: "particles",
        name: "Particles",
        count: 4,
        angle: 0,
        spread: 20,
        speed: [50, 60],
        life: [1, 1],
        gravity: { x: 0, y: 0 },
        size: curve(1),
        opacity: curve(1),
      }),
    ],
  });
  const before = await page.evaluate((p) => window.vfx.preview(p, 0.25), trail);
  if (trail.layers[0].type !== "particles") throw Error();
  trail.layers[0].trail = { samples: 6, seconds: 0.15, width: 1, opacity: 1 };
  const after = await page.evaluate((p) => window.vfx.preview(p, 0.25), trail);
  expect(visible(after)).toBeGreaterThan(visible(before));
  await page.evaluate((p) => window.vfx.preview(p, 0.6), trail);
  expect(await page.evaluate((p) => window.vfx.preview(p, 0.25), trail)).toBe(
    after,
  );
});

test("variant exports and trimmed sequences agree with the actual preview", async ({
  page,
}) => {
  await page.goto("/render.html");
  await page.waitForFunction(() => !!window.vfx);
  let p = getPreset();
  p.duration = 0.4;
  p.fps = 10;
  p = captureVariant(p, "original", "Original");
  p = captureVariant(setControl(p, "hue", 120), "green", "Green");
  p.editor.reference = {
    image: getPreset("flipbook_burst").assets[0],
    position: { x: 64, y: 64 },
    scale: 1,
    opacity: 0.7,
    visible: true,
    plane: "behind",
  };
  const files = await page.evaluate(
    (p) => window.vfx.variants(p, ["original", "green"], { format: "gif" }),
    p,
  );
  expect(files["original/animation.gif"]).toBeTruthy();
  expect(files["green/animation.gif"]).toBeTruthy();
  expect(files["original/animation.gif"]).not.toBe(
    files["green/animation.gif"],
  );
  expect(
    JSON.parse(Buffer.from(files["variants.vfx.json"], "base64").toString())
      .editor.reference,
  ).toBeUndefined();
  expect(
    JSON.parse(
      Buffer.from(files["original/effect.vfx.json"], "base64").toString(),
    ).editor.reference,
  ).toBeUndefined();
  const range = await page.evaluate(
    (p) => window.vfx.export(p, { format: "sequence", start: 0.1, end: 0.31 }),
    p,
  );
  const meta = JSON.parse(
    Buffer.from(range["metadata.json"], "base64").toString(),
  );
  expect(meta.duration).toBeCloseTo(0.21);
  expect(meta.sourceRange).toEqual({ start: 0.1, end: 0.31 });
  expect(meta.frames).toHaveLength(3);
  const frame = PNG.sync.read(Buffer.from(range["frames/0000.png"], "base64")),
    expected = PNG.sync.read(
      Buffer.from(
        await page.evaluate((p) => window.vfx.preview(p, 0.1), p),
        "base64",
      ),
    );
  expect(frame.data).toEqual(expected.data);
});

test("simple effect controls support one-step undo and save multiple looks", async ({
  page,
}) => {
  await start(page);
  await expect(
    page.getByLabel("New control name", { exact: true }),
  ).toBeHidden();
  const before = await snapshot(page);
  await page.getByLabel("Control Size", { exact: true }).focus();
  await page.keyboard.press("End");
  const larger = await snapshot(page);
  expect(larger.controls.find((c) => c.id === "size")!.value).toBe(3);
  expect(larger.layers).toEqual(before.layers);
  await button(page, "Undo").click();
  expect((await snapshot(page)).controls).toEqual(before.controls);
  await button(page, "Looks").click();
  await page.getByLabel("Look name", { exact: true }).fill("Original");
  await button(page, "Save current look").click();
  await expect(page.locator(".variant-card img")).toHaveCount(1);
  await button(page, "Close dialog").click();
  await page.getByLabel("Control Hue", { exact: true }).focus();
  await page.keyboard.press("End");
  await button(page, "Looks").click();
  await page.getByLabel("Look name", { exact: true }).fill("Alternate");
  await button(page, "Save current look").click();
  await expect(page.locator(".variant-card img")).toHaveCount(2);
  await page
    .locator(".variant-card")
    .filter({ has: page.locator("strong", { hasText: "Original" }) })
    .getByRole("button", { name: "Use look", exact: true })
    .click();
  expect(
    (await snapshot(page)).controls.find((c) => c.id === "hue")!.value,
  ).toBe(0);
});

test("a 0.7.0 saved component survives upgrade and inserts as editable layers", async ({
  page,
}) => {
  await start(page);
  await button(page, "saved").click();
  await page.getByLabel("Component name", { exact: true }).fill("My sparks");
  await button(page, "Save selection (1)").click();
  await expect(page.locator(".component-card")).toHaveCount(1);
  // Preserve a real persisted item from the previous application version.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("vfx-maker-projects", 3);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("components", "readwrite");
        const store = tx.objectStore("components");
        const request = store.getAll();
        request.onsuccess = () => {
          for (const item of request.result) {
            item.component.version = "0.7.0";
            item.component.project.version = "0.7.0";
            store.put(item);
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });
  await page.reload();
  await button(page, "Pause").click();
  await button(page, "saved").click();
  await expect(page.locator(".component-card")).toContainText("My sparks");
  const before = await snapshot(page);
  await page
    .getByRole("button", { name: "Insert My sparks", exact: true })
    .click();
  const inserted = await snapshot(page);
  expect(inserted.layers).toHaveLength(before.layers.length + 1);
  expect(new Set(inserted.layers.map((l) => l.id)).size).toBe(
    inserted.layers.length,
  );
  await button(page, "Undo").click();
  expect((await snapshot(page)).layers).toEqual(before.layers);
  await button(page, "saved").click();
  await expect(page.locator(".component-card")).toHaveCount(1);
});

test("cancelling a macro drag keeps the document and a completed drag is one undo", async ({
  page,
}) => {
  await start(page);
  const before = await snapshot(page),
    slider = page.getByLabel("Control Size", { exact: true }),
    box = (await slider.boundingBox())!;
  const startX = box.x + (box.width * (1 - 0.25)) / (3 - 0.25),
    y = box.y + box.height / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, y, { steps: 6 });
  await slider.dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  await expect(slider).toHaveValue("1");
  expect((await snapshot(page)).controls).toEqual(before.controls);
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, y, { steps: 8 });
  await page.mouse.up();
  expect(
    (await snapshot(page)).controls.find((c) => c.id === "size")!.value,
  ).toBeGreaterThan(1);
  await button(page, "Undo").click();
  expect((await snapshot(page)).controls).toEqual(before.controls);
});

test("multi-channel keys move together and auto-key preserves the base transform", async ({
  page,
}) => {
  await start(page);
  await page
    .locator(".layer-select")
    .filter({ hasText: "First slash" })
    .click();
  await button(page, "Keyframes").click();
  await button(page, "All channels").click();
  const before = await snapshot(page);
  await page
    .getByRole("button", { name: "First slash opacity key 0", exact: true })
    .click();
  await page
    .getByRole("button", { name: "First slash motion.x key 0", exact: true })
    .click({ modifiers: ["Shift"] });
  await expect(page.locator(".dope-toolbar")).toContainText("2 keys selected");
  await page.locator(".dope-toolbar > summary").click();
  await button(page, "Move keys").click();
  const moved = await snapshot(page),
    old = before.layers.find((l) => l.id === "cut-a")!,
    current = moved.layers.find((l) => l.id === "cut-a")!;
  expect(current.opacity[0].t).toBeGreaterThan(old.opacity[0].t);
  expect(current.motion.x[0].t).toBeGreaterThan(old.motion.x[0].t);
  expect(current.motion.y).toEqual(old.motion.y);
  await button(page, "Undo").click();
  await button(page, "Keyframes").click();
  await button(page, "Auto key").click();
  const x = page.getByLabel("Position X", { exact: true });
  await x.fill("70");
  await x.blur();
  const keyed = (await snapshot(page)).layers.find((l) => l.id === "cut-a")!;
  expect(keyed.position).toEqual(old.position);
  expect(keyed.motion.x.some((k) => k.value === 6)).toBe(true);
});

test("new dialogs and advanced disclosures stay reachable on narrow and short screens", async ({
  page,
}) => {
  await start(page);
  for (const [width, height] of [
    [390, 700],
    [640, 360],
  ]) {
    await page.setViewportSize({ width, height });
    await button(page, "Looks").click();
    await expect(
      page.getByRole("dialog", { name: "Looks & variations" }),
    ).toBeVisible();
    await page.getByLabel("Look name", { exact: true }).fill(`Look ${width}`);
    await button(page, "Save current look").click();
    await expect(
      button(page, "Export selected (1)").or(
        button(page, "Export selected (2)"),
      ),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    await button(page, "Close dialog").click();
    await button(page, "Timing tools").click();
    await expect(
      page.getByRole("dialog", { name: "Timing tools" }),
    ).toBeVisible();
    await expect(button(page, "Stretch effect")).toBeVisible();
    await button(page, "Close dialog").click();
  }
});
