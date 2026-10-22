import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";
import { getPreset, type Project } from "../../src/core/index.js";
async function start(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByLabel("Playhead", { exact: true }).fill("0.4");
  await expect(page.locator(".pixi-host canvas")).toBeVisible();
}
async function save(page: Page): Promise<Project> {
  const wait = page.waitForEvent("download");
  await page.locator(".topbar").getByRole("button", { name: /^Save/ }).click();
  return JSON.parse(await readFile((await (await wait).path())!, "utf8"));
}
async function open(page: Page, p: Project) {
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "effect.vfx.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(p)),
    });
}
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
test("small windows, browser zoom-sized viewports and a 512px canvas remain usable without page overflow", async ({
  page,
}) => {
  await start(page);
  const p = getPreset();
  p.canvas.width = 512;
  p.canvas.height = 512;
  await open(page, p);
  for (const [width, height] of [
    [1440, 1000],
    [1024, 640],
    [768, 640],
    [390, 700],
    [640, 360],
  ]) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(width);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBe(height);
    const exportButton = page.locator(".topbar .primary"),
      b = (await exportButton.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(width);
    expect(b.y).toBeGreaterThanOrEqual(0);
    const area = (await page.locator(".viewport-area").boundingBox())!,
      canvas = (await page.locator(".canvas-stack").boundingBox())!;
    expect(canvas.width).toBeLessThanOrEqual(area.width);
    expect(canvas.height).toBeLessThanOrEqual(area.height);
    await exportButton.click();
    await expect(
      page.getByRole("dialog", { name: "Export effect" }),
    ).toBeVisible();
    await button(page, "Close dialog").click();
  }
  await page.setViewportSize({ width: 390, height: 700 });
  await button(page, "Inspector").click();
  await expect(page.getByLabel("Canvas width", { exact: true })).toHaveValue(
    "512",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Canvas width", { exact: true })).toBeHidden();
  await button(page, "Library").click();
  await button(page, "effects").click();
  await page
    .getByRole("button", { name: "Portal ribbons", exact: false })
    .click();
  await expect(page.locator(".library")).toBeHidden();
});
test("panel dividers support keyboard resize, persistent layout and collapse without changing the project", async ({
  page,
}) => {
  await start(page);
  const before = await save(page),
    divider = page.getByRole("separator", { name: "Resize library" });
  await divider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "256");
  await button(page, "Inspector").click();
  await expect(page.locator(".inspector-panel")).toBeHidden();
  await page.reload();
  await expect(page.locator(".inspector-panel")).toBeHidden();
  await expect(divider).toHaveAttribute("aria-valuenow", "256");
  await button(page, "Timeline").click();
  await expect(page.locator(".timeline-tracks")).toBeHidden();
  expect((await save(page)).layers).toEqual(before.layers);
  await button(page, "Reset layout").click();
  await expect(page.locator(".inspector-panel")).toBeVisible();
});
test("Fit, pixel grid and panning work without moving a layer; keyboard nudges are undoable", async ({
  page,
}) => {
  await start(page);
  const before = await save(page);
  await page.getByLabel("Preview zoom", { exact: true }).selectOption("4");
  await button(page, "Pixel grid").click();
  await expect(page.locator(".pixel-grid")).toBeVisible();
  await button(page, "Pan canvas").click();
  const area = (await page.locator(".viewport-area").boundingBox())!,
    old = (await page.locator(".canvas-stack").boundingBox())!;
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    area.x + area.width / 2 + 35,
    area.y + area.height / 2 + 20,
  );
  await page.mouse.up();
  const moved = (await page.locator(".canvas-stack").boundingBox())!;
  expect(moved.x - old.x).toBeCloseTo(35, 0);
  expect((await save(page)).layers).toEqual(before.layers);
  await button(page, "Fit canvas").click();
  await button(page, "Pan canvas").click();
  await page.locator(".viewport-area").click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("Shift+ArrowRight");
  const after = await save(page),
    id = before.layers.at(-1)!.id;
  expect(after.layers.find((l) => l.id === id)!.position.x).toBe(
    before.layers.at(-1)!.position.x + 10,
  );
  await button(page, "Undo").click();
  expect((await save(page)).layers).toEqual(before.layers);
});
test("pointer cancellation reverts a timeline drag instead of committing its draft", async ({
  page,
}) => {
  await start(page);
  const before = await save(page),
    clip = page.locator(".timeline-clip").filter({ hasText: "First slash" }),
    b = (await clip.boundingBox())!;
  await page.mouse.move(b.x + 15, b.y + 10);
  await page.mouse.down();
  await page.mouse.move(b.x + 60, b.y + 10, { steps: 3 });
  await clip.dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  expect((await save(page)).layers).toEqual(before.layers);
});
test("modal focus stays inside, prevents background shortcuts and restores the opener", async ({
  page,
}) => {
  await start(page);
  const opener = button(page, "Resize canvas");
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Resize canvas" });
  await expect(dialog).toBeVisible();
  let downloads = 0;
  page.on("download", () => downloads++);
  await page.keyboard.press("Control+s");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest("[role=dialog]"),
    ),
  ).toBe(true);
  expect(downloads).toBe(0);
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
});
test("pixel worker handles fast setting changes and downloads the actual preview dimensions and palette", async ({
  page,
}) => {
  await start(page);
  await button(page, "Pixel optimizer").click();
  const download = button(page, "Download PNG");
  await expect(download).toBeEnabled();
  await page.getByLabel("Color limit", { exact: true }).selectOption("256");
  await page.getByLabel("Color limit", { exact: true }).selectOption("8");
  await page.getByLabel("Color limit", { exact: true }).selectOption("16");
  await page.getByLabel("Output scale", { exact: true }).selectOption("0.5");
  await page.getByLabel("Alpha levels", { exact: true }).selectOption("4");
  await expect(download).toBeEnabled();
  await expect(page.locator(".optimizer-stats")).toContainText("64 × 64");
  const wait = page.waitForEvent("download");
  await download.click();
  const png = PNG.sync.read(await readFile((await (await wait).path())!));
  expect(png.width).toBe(64);
  expect(png.height).toBe(64);
  const colors = new Set<string>();
  for (let i = 0; i < png.data.length; i += 4) {
    expect([0, 85, 170, 255]).toContain(png.data[i + 3]);
    if (png.data[i + 3]) colors.add([...png.data.subarray(i, i + 3)].join(","));
  }
  expect(colors.size).toBeLessThanOrEqual(16);
  await button(page, "Use settings for exports").click();
  expect((await save(page)).output).toMatchObject({
    scale: 0.5,
    colors: 16,
    alphaLevels: 4,
  });
  await page.locator(".topbar .primary").click();
  await expect(page.getByLabel("Export scale", { exact: true })).toHaveValue(
    "0.5",
  );
  await expect(page.getByLabel("Export colors", { exact: true })).toHaveValue(
    "16",
  );
});
test("optimizes an embedded flipbook with grid intact and undo restores its original bytes", async ({
  page,
}) => {
  await start(page);
  const p = getPreset("flipbook_burst");
  await open(page, p);
  await button(page, "assets").click();
  await button(page, "Optimize PNG").click();
  await expect(button(page, "Replace texture")).toBeEnabled();
  await page.getByLabel("Output scale", { exact: true }).selectOption("0.5");
  await page.getByLabel("Color limit", { exact: true }).selectOption("16");
  await expect(button(page, "Replace texture")).toBeEnabled();
  await expect(page.locator(".optimizer-stats")).toContainText(
    `${p.assets[0].width / 2} × ${p.assets[0].height / 2}`,
  );
  await button(page, "Replace texture").click();
  const next = await save(page);
  expect(next.assets[0]).toMatchObject({
    columns: 3,
    rows: 2,
    frames: 6,
    width: p.assets[0].width / 2,
    height: p.assets[0].height / 2,
  });
  await button(page, "Undo").click();
  expect((await save(page)).assets).toEqual(p.assets);
});
test("canvas scaling is one edit and recent projects restore complete compositions", async ({
  page,
}) => {
  await start(page);
  const before = await save(page);
  await button(page, "Resize canvas").click();
  await page.getByLabel("New canvas width", { exact: true }).fill("64");
  await page.getByLabel("New canvas width", { exact: true }).blur();
  await page.getByLabel("New canvas height", { exact: true }).fill("64");
  await page.getByLabel("New canvas height", { exact: true }).blur();
  await button(page, "Apply resize").click();
  const half = await save(page);
  expect(half.canvas.width).toBe(64);
  expect(half.layers[0].scale).toBe(before.layers[0].scale * 0.5);
  await button(page, "Undo").click();
  expect((await save(page)).layers).toEqual(before.layers);
  await page.getByLabel("Effect name", { exact: true }).fill("My saved slash");
  await save(page);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const r = indexedDB.open("vfx-maker-projects", 1);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        try {
          return await new Promise<boolean>((resolve) => {
            const r = db
              .transaction("recent")
              .objectStore("recent")
              .get("My saved slash");
            r.onsuccess = () => resolve(!!r.result);
          });
        } finally {
          db.close();
        }
      }),
    )
    .toBe(true);
  await button(page, "effects").click();
  await page
    .getByRole("button", { name: "Portal ribbons", exact: false })
    .click();
  await button(page, "Recent").click();
  await page
    .getByRole("button", { name: "My saved slash", exact: false })
    .first()
    .click();
  expect((await save(page)).name).toBe("My saved slash");
  expect((await save(page)).layers).toEqual(before.layers);
});
test("recolors selected gradients with real preview and a single undo while retaining texture bytes", async ({
  page,
}) => {
  await start(page);
  const before = await save(page);
  await page
    .locator(".layer-select")
    .filter({ hasText: "First slash" })
    .click();
  await button(page, "Recolor").click();
  await page
    .getByLabel("Recolor scope", { exact: true })
    .selectOption("selected");
  await page.getByLabel("Hue rotation", { exact: true }).fill("120");
  await page.getByLabel("Hue rotation", { exact: true }).blur();
  await expect(page.locator(".recolor-preview canvas")).toBeVisible();
  await button(page, "Apply colors").click();
  const next = await save(page);
  expect(next.layers.find((l) => l.id === "cut-a")!.colors).not.toEqual(
    before.layers.find((l) => l.id === "cut-a")!.colors,
  );
  expect(next.layers.find((l) => l.id === "cut-b")).toEqual(
    before.layers.find((l) => l.id === "cut-b"),
  );
  expect(next.assets).toEqual(before.assets);
  await button(page, "Undo").click();
  expect((await save(page)).layers).toEqual(before.layers);
});
test("optimizer rejects oversized image headers before handing the source to an image element", async ({
  page,
}) => {
  await start(page);
  await button(page, "Pixel optimizer").click();
  await expect(button(page, "Download PNG")).toBeEnabled();
  const image = new PNG({ width: 2048, height: 1 });
  await page.getByLabel("Open optimizer PNG", { exact: true }).setInputFiles({
    name: "oversized.png",
    mimeType: "image/png",
    buffer: PNG.sync.write(image),
  });
  await expect(page.getByRole("alert")).toContainText("1024");
  await expect(page.getByAltText("Original PNG", { exact: true })).toHaveCount(
    0,
  );
  await expect(button(page, "Download PNG")).toBeDisabled();
});
