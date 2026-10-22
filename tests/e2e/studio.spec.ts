import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { getPreset, type Project } from "../../src/core/index.js";
async function saved(page: Page): Promise<Project> {
  const wait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  const d = await wait;
  return JSON.parse(await readFile((await d.path())!, "utf8"));
}
async function paused(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByLabel("Playhead", { exact: true }).fill("0.4");
  await expect(page.locator(".pixi-host canvas")).toBeVisible();
}
test("customizes directly, reshapes a stroke and supports undo/redo and project roundtrip", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await paused(page);
  await page
    .locator(".layer-select")
    .filter({ hasText: "First slash" })
    .click();
  await page.getByLabel("Position X", { exact: true }).fill("70");
  await page.getByLabel("Position X", { exact: true }).blur();
  expect(
    (await saved(page)).layers.find((l) => l.id === "cut-a")!.position.x,
  ).toBe(70);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(
    (await saved(page)).layers.find((l) => l.id === "cut-a")!.position.x,
  ).toBe(64);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  const point = page.getByLabel("Drag point 1", { exact: true }),
    box = (await point.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 24,
    box.y + box.height / 2 + 12,
    { steps: 4 },
  );
  await page.mouse.up();
  const p = await saved(page),
    stroke = p.layers.find((l) => l.id === "cut-a")!;
  expect(stroke.type).toBe("path");
  if (stroke.type !== "path") throw new Error();
  expect(stroke.points[0]).toEqual({ x: -32, y: -34 });
  await page.reload();
  await expect(page.getByLabel("Effect name")).toHaveValue("Crimson cross");
  expect((await saved(page)).layers).toEqual(p.layers);
  expect(errors).toEqual([]);
});
test("retimes a layer, edits a curve, adds and reorders layers, and locks edits", async ({
  page,
}) => {
  await paused(page);
  await page
    .locator(".layer-select")
    .filter({ hasText: "First slash" })
    .click();
  const clip = page
    .locator(".timeline-clip")
    .filter({ hasText: "First slash" });
  const b = (await clip.boundingBox())!;
  await page.mouse.move(b.x + 20, b.y + 10);
  await page.mouse.down();
  await page.mouse.move(b.x + 70, b.y + 10, { steps: 5 });
  await page.mouse.up();
  expect(
    (await saved(page)).layers.find((l) => l.id === "cut-a")!.start,
  ).toBeGreaterThan(0.06);
  const graph = page.getByRole("img", { name: "Width curve", exact: true });
  await graph.dblclick({ position: { x: 65, y: 20 } });
  await expect(
    page.getByLabel("Width key 4 value", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Width key 2 value", { exact: true }).fill("11");
  await page.getByLabel("Width key 2 value", { exact: true }).blur();
  const p = await saved(page);
  const stroke = p.layers.find((l) => l.id === "cut-a")!;
  if (stroke.type !== "path") throw new Error();
  expect(stroke.width.some((k) => k.value === 11)).toBe(true);
  await page.getByRole("button", { name: "Add ring", exact: true }).click();
  expect((await saved(page)).layers).toHaveLength(5);
  await page
    .getByRole("button", { name: "Lock New ring", exact: true })
    .click();
  await expect(
    page.getByText("This layer is locked.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Unlock New ring", exact: true })
    .click();
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  expect((await saved(page)).layers).toHaveLength(6);
  const rows = page.locator(".layer-row");
  await rows.nth(0).dragTo(rows.nth(2));
  expect((await saved(page)).layers.at(-1)!.name).toBe("New ring");
});
test("opens a portable textured effect and renders a downloadable GIF ZIP", async ({
  page,
}) => {
  await paused(page);
  const p = getPreset("flipbook_burst");
  p.duration = 0.3;
  p.fps = 10;
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "blast.vfx.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(p)),
    });
  await expect(page.getByLabel("Effect name", { exact: true })).toHaveValue(
    "Flipbook blast",
  );
  await page.getByRole("button", { name: "assets", exact: true }).click();
  await expect(page.locator(".asset-preview img")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Export", exact: false })
    .first()
    .click();
  await page.getByLabel("GIF scale", { exact: true }).fill("1");
  await page.getByLabel("GIF scale", { exact: true }).blur();
  const wait = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Render & download ZIP", exact: false })
    .click();
  const d = await wait;
  const bytes = await readFile((await d.path())!);
  expect(bytes.subarray(0, 2).toString()).toBe("PK");
  expect(d.suggestedFilename()).toContain("gif.zip");
  await expect(page.getByRole("status")).toContainText("Export complete");
});
test("imports a PNG, authors a sprite and reports invalid input without losing the project", async ({
  page,
}) => {
  await paused(page);
  await page.getByRole("button", { name: "assets", exact: true }).click();
  const asset = getPreset("stardust").assets[0];
  await page
    .locator("input[type=file]")
    .nth(1)
    .setInputFiles({
      name: "spark.png",
      mimeType: "image/png",
      buffer: Buffer.from(asset.data.split(",")[1], "base64"),
    });
  await expect(page.locator(".asset-preview img")).toHaveCount(1);
  await page.getByRole("button", { name: "layers", exact: true }).click();
  await page.getByRole("button", { name: "Add sprite", exact: true }).click();
  const p = await saved(page);
  expect(p.layers.at(-1)!.type).toBe("sprite");
  expect(p.assets).toHaveLength(1);
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "broken.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"version":"99"}'),
    });
  await expect(page.getByRole("status")).toContainText("0.4.0");
  expect((await saved(page)).layers).toEqual(p.layers);
});
