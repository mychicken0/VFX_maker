import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import type { Project } from "../core/model.js";
import type { ExportOptions } from "../render/export.js";
import { serve } from "./server.js";
import type { ObservationInput } from "../core/observation.js";
import type { AnalysisInput } from "../core/analysis.js";
export type RenderRequest =
  | { analysis: AnalysisInput }
  | { time: number }
  | { options: ExportOptions; variants?: string[] }
  | { observation: ObservationInput; draft?: boolean };
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
type Worker = {
  browser: Awaited<ReturnType<typeof chromium.launch>>;
  server: Awaited<ReturnType<typeof serve>>;
  page: Awaited<
    ReturnType<Awaited<ReturnType<typeof chromium.launch>>["newPage"]>
  >;
  token: number;
  progress?: (completed: number, total: number) => void;
  dirty: boolean;
};
type Slot = {
  busy: boolean;
  worker?: Worker;
  creating?: Promise<Worker>;
  timer?: ReturnType<typeof setTimeout>;
};
const slots: Slot[] = [];
let launches = 0,
  requests = 0,
  reuses = 0,
  generation = 0;
export function renderStats() {
  return {
    launches,
    requests,
    reuses,
    active: slots.filter((s) => s.busy).length,
    idle: slots.filter((s) => !s.busy && s.worker).length,
    maxWorkers: 2,
    idleSeconds: 30,
  };
}
async function dispose(slot: Slot) {
  clearTimeout(slot.timer);
  const worker = slot.worker;
  slot.worker = undefined;
  if (worker) {
    await worker.browser.close().catch(() => {});
    await worker.server.close();
  }
}
export async function closeRenderPool() {
  generation++;
  await Promise.allSettled(
    slots.map(async (s) => {
      await s.creating?.catch(() => {});
      await dispose(s);
    }),
  );
  slots.length = 0;
}
async function createWorker(): Promise<Worker> {
  const executablePath = browserPath();
  if (!executablePath)
    throw Error(
      "Chromium is required for CLI/MCP rendering. Run vfx browser install or set VFX_CHROMIUM_PATH.",
    );
  const server = await serve();
  let browser: Worker["browser"] | undefined;
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
    launches++;
    const page = await browser.newPage(),
      worker: Worker = { browser, server, page, token: 0, dirty: false };
    page.on("pageerror", () => {
      worker.dirty = true;
    });
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
      (token: number, completed: number, total: number) => {
        if (token === worker.token) worker.progress?.(completed, total);
      },
    );
    await page.goto(server.url + "/render.html");
    await page.waitForFunction(() => !!window.vfx, undefined, {
      timeout: 30000,
    });
    await page.evaluate(() =>
      window.addEventListener("vfx-progress", (event) => {
        const w = window as unknown as {
            vfxTaskId: number;
            vfxProgress: (id: number, a: number, b: number) => void;
          },
          d = (event as CustomEvent).detail;
        void w.vfxProgress(w.vfxTaskId, d.completed, d.total);
      }),
    );
    return worker;
  } catch (e) {
    await browser?.close().catch(() => {});
    await server.close();
    throw e;
  }
}
export async function render(
  project: Project,
  request: RenderRequest,
  signal?: AbortSignal,
  progress?: (completed: number, total: number) => void,
): Promise<Record<string, Buffer>> {
  signal?.throwIfAborted();
  let slot =
    slots.find(
      (s) =>
        !s.busy &&
        s.worker &&
        !s.worker.dirty &&
        s.worker.browser.isConnected() &&
        !s.worker.page.isClosed(),
    ) ?? slots.find((s) => !s.busy);
  if (!slot) {
    if (slots.length >= 2)
      throw Error(
        "Renderer busy (two active renders). Wait for an export to finish.",
      );
    slot = { busy: false };
    slots.push(slot);
  }
  slot.busy = true;
  clearTimeout(slot.timer);
  const epoch = generation;
  let abort: (() => void) | undefined;
  try {
    if (
      slot.worker &&
      (slot.worker.dirty ||
        !slot.worker.browser.isConnected() ||
        slot.worker.page.isClosed())
    )
      await dispose(slot);
    if (!slot.worker) {
      slot.creating = createWorker();
      slot.worker = await slot.creating;
      slot.creating = undefined;
    } else reuses++;
    if (epoch !== generation)
      throw Error("Renderer pool closed during startup");
    const worker = slot.worker;
    requests++;
    worker.token++;
    worker.progress = progress;
    abort = () => {
      worker.dirty = true;
      void worker.browser.close().catch(() => {});
    };
    signal?.addEventListener("abort", abort, { once: true });
    signal?.throwIfAborted();
    const encoded = await worker.page.evaluate(
      async ({ project, request, token }) => {
        (window as unknown as { vfxTaskId: number }).vfxTaskId = token;
        return "analysis" in request
          ? window.vfx.analyze(project, request.analysis)
          : "observation" in request
            ? window.vfx.observe(project, request.observation, request.draft)
            : "time" in request
              ? {
                  "preview.png": await window.vfx.preview(
                    project,
                    request.time,
                  ),
                }
              : request.variants
                ? window.vfx.variants(
                    project,
                    request.variants,
                    request.options,
                  )
                : window.vfx.export(project, request.options);
      },
      { project, request, token: worker.token },
    );
    signal?.throwIfAborted();
    return Object.fromEntries(
      Object.entries(encoded).map(([name, value]) => [
        name,
        Buffer.from(value, "base64"),
      ]),
    );
  } catch (e) {
    signal?.throwIfAborted();
    throw e;
  } finally {
    if (abort) signal?.removeEventListener("abort", abort);
    if (slot.worker) slot.worker.progress = undefined;
    slot.busy = false;
    if (slot.worker?.dirty || epoch !== generation) await dispose(slot);
    else {
      slot.timer = setTimeout(() => {
        if (!slot.busy) void dispose(slot);
      }, 30000);
      slot.timer.unref();
    }
  }
}
