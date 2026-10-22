import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  PRESETS,
  getPreset,
  parseProject,
  type Project,
} from "../../src/core/index.js";

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: "image/png" });
}
async function start(page: Page) {
  await page.goto("/");
  await button(page, "Pause").click();
  await page.getByLabel("Playhead", { exact: true }).fill("0.4");
  await expect(page.locator(".pixi-host canvas")).toBeVisible();
}
async function open(page: Page, project: Project) {
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "layout-audit.vfx.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
  await expect(page.getByLabel("Effect name", { exact: true })).toHaveValue(
    project.name,
  );
}
async function library(page: Page) {
  if (page.viewportSize()!.width < 1000) await button(page, "Library").click();
}

for (const [width, height] of [
  [1917, 963],
  [1440, 1000],
  [1024, 640],
  [390, 700],
  [640, 360],
]) {
  test(`effect cards keep their image and text and scroll at ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await start(page);
    await library(page);
    await button(page, "effects").click();
    const list = page.locator(".preset-list"),
      cards = page.locator(".preset-card");
    await expect(cards).toHaveCount(PRESETS.length);
    await expect
      .poll(() =>
        cards
          .locator("img")
          .evaluateAll((images) =>
            images.every((im) => (im as HTMLImageElement).naturalWidth > 0),
          ),
      )
      .toBe(true);
    // Visibility alone passes for a 21px clipped button. Measure its content.
    const layout = await cards.evaluateAll((cards) =>
      cards.map((card) => {
        const box = card.getBoundingClientRect();
        return {
          height: box.height,
          clipped: card.scrollHeight > card.clientHeight + 1,
          childrenInside: [...card.querySelectorAll("img,b,p")].every((el) => {
            const child = el.getBoundingClientRect();
            return (
              child.top >= box.top &&
              child.bottom <= box.bottom &&
              child.left >= box.left &&
              child.right <= box.right
            );
          }),
        };
      }),
    );
    for (const card of layout) {
      expect(card.height).toBeGreaterThanOrEqual(130);
      expect(card.clipped).toBe(false);
      expect(card.childrenInside).toBe(true);
    }
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
      true,
    );
    await capture(page, info, "effects-top");
    await cards.last().scrollIntoViewIfNeeded();
    await expect(cards.last().locator("b")).toBeInViewport();
    await capture(page, info, "effects-bottom");
    await cards.last().click();
    if (width < 1000) {
      await expect(page.locator(".library")).toBeHidden();
      await button(page, "Inspector").click();
    }
    await expect(page.getByLabel("Effect name", { exact: true })).toHaveValue(
      PRESETS.at(-1)!.name,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  });
}

test("effect search counts matches, keeps a single card compact and offers recovery from no matches", async ({
  page,
}) => {
  await start(page);
  await button(page, "effects").click();
  const search = page.getByLabel("Search effects", { exact: true });
  await search.fill("  CRIMSON  ");
  await expect(page.locator(".search small")).toHaveText("1");
  await expect(page.locator(".preset-card")).toHaveCount(1);
  expect(
    (await page.locator(".preset-card").boundingBox())!.height,
  ).toBeLessThan(240);
  await search.fill("no such effect 123");
  await expect(page.locator(".search small")).toHaveText("0");
  await expect(
    page.getByText("No matching effects.", { exact: false }),
  ).toBeVisible();
  await button(page, "Clear search").click();
  await expect(page.locator(".preset-card")).toHaveCount(PRESETS.length);
  await expect(search).toHaveValue("");
});

for (const [width, height] of [
  [1440, 1000],
  [640, 360],
  [390, 700],
]) {
  test(`all library tabs remain reachable with full content at ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await start(page);
    // Import a realistic worst-case panel: 32 layers, 8 textures, long names.
    const p = getPreset("flipbook_burst");
    p.layers = Array.from({ length: 32 }, (_, i) => ({
      ...structuredClone(p.layers[0]),
      id: `part-${i}`,
      name: `Layer ${i} ${"long name ".repeat(8)}`.slice(0, 100),
    }));
    p.controls = [];
    p.assets = Array.from({ length: 8 }, (_, i) => ({
      ...p.assets[0],
      id: i ? `texture-${i}` : p.assets[0].id,
      name: `Texture-${i}-${"long_filename_".repeat(8)}`.slice(0, 100),
    }));
    p.editor.reference = {
      image: p.assets[0],
      position: { x: 64, y: 64 },
      scale: 1,
      opacity: 0.7,
      visible: true,
      plane: "behind",
    };
    // Expect the import to validate before exercising panel navigation.
    parseProject(p);
    if (width < 1000) await button(page, "Inspector").click();
    await open(page, p);
    if (width < 1000) await page.keyboard.press("Escape");
    await library(page);
    await button(page, "layers").click();
    await expect(page.locator(".layer-row")).toHaveCount(32);
    expect(
      await page
        .locator(".library-body")
        .evaluate((el) => el.scrollHeight > el.clientHeight),
    ).toBe(true);
    await page.locator(".layer-row").last().scrollIntoViewIfNeeded();
    await expect(page.locator(".layer-row").last()).toBeInViewport();
    await button(page, "Add ring").scrollIntoViewIfNeeded();
    await expect(button(page, "Add ring")).toBeInViewport();
    await capture(page, info, "layers-bottom");
    await button(page, "assets").click();
    await expect(page.locator(".asset-card")).toHaveCount(8);
    await page
      .locator(".asset-card")
      .last()
      .getByRole("button", { name: "Optimize PNG" })
      .scrollIntoViewIfNeeded();
    const assetLayout = await page.locator(".asset-card").evaluateAll((cards) =>
      cards.map((el) => ({
        clip: el.scrollHeight > el.clientHeight + 1,
        overflow: el.scrollWidth > el.clientWidth + 1,
      })),
    );
    expect(assetLayout.every((el) => !el.clip && !el.overflow)).toBe(true);
    await capture(page, info, "assets-bottom");
    await button(page, "reference").click();
    await page
      .getByLabel("Reference opacity", { exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByLabel("Reference opacity", { exact: true }),
    ).toBeInViewport();
    await capture(page, info, "reference");
    await button(page, "saved").click();
    await button(page, "Import component").scrollIntoViewIfNeeded();
    await expect(button(page, "Import component")).toBeInViewport();
    await capture(page, info, "saved");
    await button(page, "effects").click();
    await expect(
      page.getByLabel("Search effects", { exact: true }),
    ).toBeInViewport();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  });
}

test("Play and Space replay a non-looping effect after its end; Restart uses the loop range", async ({
  page,
}) => {
  await start(page);
  const p = getPreset();
  p.loop = false;
  p.duration = 0.5;
  await open(page, p);
  const playhead = page.getByLabel("Playhead", { exact: true });
  for (const keyboard of [false, true]) {
    await playhead.fill("0.5");
    if (keyboard) {
      await page.locator(".viewport-area").click({ position: { x: 5, y: 5 } });
      await page.keyboard.press("Space");
    } else await button(page, "Play").click();
    await expect(button(page, "Pause")).toBeVisible();
    await button(page, "Pause").click();
    expect(Number(await playhead.inputValue())).toBeLessThan(0.5);
  }
  p.editor.range = { start: 0.2, end: 0.4 };
  await open(page, p);
  await playhead.fill("0.3");
  await button(page, "Restart playback").click();
  await button(page, "Pause").click();
  expect(Number(await playhead.inputValue())).toBeGreaterThanOrEqual(0.2);
  expect(Number(await playhead.inputValue())).toBeLessThan(0.4);
});

test("short-window keyframes show editable keys before advanced tools", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await start(page);
  await button(page, "Keyframes").click();
  await button(page, "All channels").click();
  const tools = page.locator(".dope-toolbar");
  await expect(tools).not.toHaveAttribute("open", "");
  await expect(page.locator(".dope-key").first()).toBeInViewport();
  await capture(page, info, "short-keyframes");
  await tools.locator("summary").focus();
  await page.keyboard.press("Space");
  await expect(tools).toHaveAttribute("open", "");
  await expect(button(page, "Play")).toBeVisible();
  await page
    .getByLabel("Key offset seconds", { exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByLabel("Key offset seconds", { exact: true }),
  ).toBeInViewport();
});

test("resizing the library to its limits keeps tab names readable and every tab reachable", async ({
  page,
}, info) => {
  await start(page);
  const divider = page.getByRole("separator", { name: "Resize library" });
  await divider.focus();
  for (let i = 0; i < 7; i++) await page.keyboard.press("ArrowLeft");
  await expect(divider).toHaveAttribute("aria-valuenow", "180");
  expect(
    await page
      .locator(".library-tabs button")
      .evaluateAll((es) => es.every((e) => e.scrollWidth <= e.clientWidth)),
  ).toBe(true);
  await button(page, "reference").click();
  await expect(button(page, "Import reference PNG")).toBeVisible();
  await capture(page, info, "minimum-library");
  await divider.focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "380");
  await button(page, "effects").click();
  expect(
    await page
      .locator(".library-tabs")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await capture(page, info, "maximum-library");
});
