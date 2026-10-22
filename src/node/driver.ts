import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import type { Project } from "../core/model.js";
import type { ExportOptions } from "../render/export.js";
import { serve } from "./server.js";
export function browserPath(): string | undefined {
  const env = process.env.VFX_CHROMIUM_PATH;
  if (env) {
    if (!existsSync(env))
      throw new Error(`VFX_CHROMIUM_PATH does not exist: ${env}`);
    return env;
  }
  return [
    chromium.executablePath(),
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ...(process.platform === "win32"
      ? [
          String(process.env.PROGRAMFILES) +
            "\\Google\\Chrome\\Application\\chrome.exe",
        ]
      : []),
  ].find(existsSync);
}
let activeRenders = 0;
export async function render(
  project: Project,
  request: { time: number } | { options: ExportOptions; variants?: string[] },
  signal?: AbortSignal,
  progress?: (completed: number, total: number) => void,
): Promise<Record<string, Buffer>> {
  if (activeRenders >= 2)
    throw new Error(
      "Renderer busy (two active renders). Wait for an export to finish.",
    );
  activeRenders++;
  try {
    return await renderInternal(project, request, signal, progress);
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    activeRenders--;
  }
}
async function renderInternal(
  project: Project,
  request: { time: number } | { options: ExportOptions; variants?: string[] },
  signal?: AbortSignal,
  progress?: (completed: number, total: number) => void,
): Promise<Record<string, Buffer>> {
  signal?.throwIfAborted();
  const executablePath = browserPath();
  if (!executablePath)
    throw new Error(
      "Chromium is required for CLI/MCP rendering. Run `vfx browser install` or set VFX_CHROMIUM_PATH to an installed Chrome/Chromium executable.",
    );
  const server = await serve();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const abort = () => {
    void browser?.close().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: [
        "--enable-unsafe-swiftshader",
        "--use-angle=swiftshader",
        "--disable-dev-shm-usage",
      ],
    });
    signal?.throwIfAborted();
    const page = await browser.newPage();
    await page.route("**/*", (route) =>
      route
        .request()
        .url()
        .startsWith(server.url + "/") ||
      route.request().url().startsWith("data:")
        ? route.continue()
        : route.abort(),
    );
    await page.exposeFunction(
      "vfxProgress",
      (completed: number, total: number) => progress?.(completed, total),
    );
    await Promise.race([
      (async () => {
        await page.goto(server.url + "/render.html");
        await page.waitForFunction(() => !!window.vfx, undefined, {
          timeout: 30000,
        });
      })(),
      new Promise<never>((_, reject) => page.once("pageerror", reject)),
    ]);
    await page.evaluate(() =>
      window.addEventListener("vfx-progress", (e) => {
        const d = (e as CustomEvent).detail;
        void (
          window as unknown as { vfxProgress: (a: number, b: number) => void }
        ).vfxProgress(d.completed, d.total);
      }),
    );
    const encoded = await page.evaluate(
      async ({ project, request }) =>
        "time" in request
          ? { "preview.png": await window.vfx.preview(project, request.time) }
          : request.variants
            ? window.vfx.variants(project, request.variants, request.options)
            : window.vfx.export(project, request.options),
      { project, request },
    );
    signal?.throwIfAborted();
    return Object.fromEntries(
      Object.entries(encoded).map(([name, value]) => [
        name,
        Buffer.from(value, "base64"),
      ]),
    );
  } finally {
    signal?.removeEventListener("abort", abort);
    await browser?.close();
    await server.close();
  }
}
