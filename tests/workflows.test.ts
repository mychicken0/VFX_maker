import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  defineEffect,
  ring,
  curve,
  getPreset,
  setProjectGradient,
  resolveControls,
  preflightExport,
  exportPlan,
  MAX_LAYERS,
  applyEdits,
  parseComponent,
  makeComponent,
} from "../src/core/index.js";
import { Service } from "../src/node/service.js";
import { Store } from "../src/node/store.js";
let root: string, s: Service;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vfx-workflows-"));
  s = new Service(await Store.open(root));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
describe("direct gradients and layer budgets", () => {
  it("colors neutral smoke exactly and neutralizes its full hue control without changing source pixels", () => {
    const p = getPreset("smoke");
    p.controls.find((c) => c.id === "hue")!.value = 90;
    const original = structuredClone(p),
      next = setProjectGradient(p, "#7020ff"),
      resolved = resolveControls(next);
    expect(
      resolved.layers.every(
        (l) => l.colors.length === 1 && l.colors[0].color === "#7020ff",
      ),
    ).toBe(true);
    expect(next.controls.find((c) => c.id === "hue")!.value).toBe(0);
    expect(next.controls.find((c) => c.id === "hue")!.bindings.length).toBe(
      p.layers.length,
    );
    expect(next.assets).toEqual(p.assets);
    expect(p).toEqual(original);
  });
  it("keeps locked/unselected colors unchanged through mixed hue bindings", () => {
    const p = getPreset();
    p.layers[1].locked = true;
    p.controls.find((c) => c.id === "hue")!.value = 70;
    const before = resolveControls(p),
      next = setProjectGradient(
        p,
        [
          { t: 0, color: "#2233ff" },
          { t: 1, color: "#bb33ff" },
        ],
        false,
        [p.layers[0].id, p.layers[1].id],
      ),
      resolved = resolveControls(next);
    expect(resolved.layers[0].colors).toEqual([
      { t: 0, color: "#2233ff" },
      { t: 1, color: "#bb33ff" },
    ]);
    expect(resolved.layers.slice(1).map((l) => l.colors)).toEqual(
      before.layers.slice(1).map((l) => l.colors),
    );
    expect(
      next.controls
        .find((c) => c.id === "hue")!
        .bindings.some((b) => b.layer === p.layers[0].id),
    ).toBe(false);
    expect(() => setProjectGradient(p, "invalid")).toThrow();
  });
  it("accepts 64 editable layers/groups/components while retaining independent animation and render budgets", () => {
    const p = defineEffect({
      layers: Array.from({ length: MAX_LAYERS }, (_, i) =>
        ring({ id: `r${i}`, name: `Ring ${i}`, opacity: curve(1) }),
      ),
    });
    expect(p.layers).toHaveLength(64);
    const grouped = applyEdits(p, [
      {
        action: "group_layers",
        id: "all",
        name: "All",
        ids: p.layers.map((l) => l.id),
      },
    ]);
    expect(grouped.groups[0].ids).toHaveLength(64);
    p.controls = [
      {
        id: "x",
        name: "X",
        min: 0,
        max: 2,
        value: 1,
        step: 0.1,
        bindings: p.layers.map((l) => ({
          layer: l.id,
          target: "position.x",
          mode: "multiply",
          factor: 1,
          offset: 0,
        })),
      },
    ];
    const moved = makeComponent(
      p,
      p.layers.map((l) => l.id),
      "Position-bound",
    );
    expect(moved.project.controls[0].bindings).toHaveLength(128);
    expect(
      parseComponent(
        makeComponent(
          p,
          p.layers.map((l) => l.id),
          "Many",
        ),
      ).project.layers,
    ).toHaveLength(64);
    expect(() =>
      defineEffect({
        ...p,
        layers: [...p.layers, ring({ id: "extra", name: "Extra" })],
      }),
    ).toThrow();
    expect(() =>
      defineEffect({
        ...p,
        layers: [
          {
            ...p.layers[0],
            opacity: Array.from({ length: 33 }, (_, i) => ({
              t: i / 32,
              value: 1,
              ease: "linear",
            })),
          },
        ],
      }),
    ).toThrow();
  });
  it("uses identical preflight and export limits and reports actual values", () => {
    const p = defineEffect({
        duration: 10,
        fps: 1,
        canvas: { width: 512, height: 512 },
      }),
      report = preflightExport(p, { fps: 60, scale: 8 });
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.resource === "frames")).toMatchObject({
      used: 600,
      limit: 300,
      passed: false,
    });
    expect(
      report.checks.find((c) => c.resource === "imagePixels"),
    ).toMatchObject({ used: 16777216, limit: 4194304, passed: false });
    expect(() => exportPlan(p, { fps: 60, scale: 8 })).toThrow("600 / 300");
    expect(
      preflightExport(p, { fps: 1, scale: 0.5, format: "sequence" }).ok,
    ).toBe(true);
  });
});
describe("multi-project preparation and per-file commits", () => {
  it("dry-runs 16 independent projects without writes, then commits one revision and backup per edit", async () => {
    const tasks = Array.from({ length: 16 }, (_, i) => ({
      action: "create",
      file: `p${i}.json`,
      preset: "smoke",
      edits: [
        { action: "set_gradient", colors: i % 2 ? "#6633ff" : "#ff6633" },
      ],
    }));
    const prepared = await s.prepareBatch(tasks);
    expect(prepared.results.every((r) => r.status === "ready")).toBe(true);
    expect(await readdir(root)).toEqual([]);
    const result = await s.executeBatch(prepared);
    expect(result.ok).toBe(true);
    expect(await readdir(root)).toHaveLength(16);
    const edited = await s.prepareBatch(
      result.results.map((r) => ({
        action: "edit",
        file: r.file,
        revision: r.revision,
        edits: [{ action: "update_project", patch: { seed: 12 } }],
      })),
    );
    expect((await s.executeBatch(edited)).ok).toBe(true);
    expect(await readdir(join(root, ".vfx-backups"))).toHaveLength(16);
  });
  it("reports invalid items independently and never commits a stale prepared edit", async () => {
    const a = await s.create("saved.json"),
      before = await readFile(join(root, "saved.json"));
    const prepared = await s.prepareBatch([
      {
        action: "edit",
        file: "saved.json",
        revision: a.revision,
        edits: [{ action: "update_project", patch: { seed: 5 } }],
      },
      { action: "create", file: "bad.json", preset: "missing" },
      { action: "create", file: "../escape.json" },
    ]);
    expect(prepared.results.map((r) => r.status)).toEqual([
      "ready",
      "failed",
      "failed",
    ]);
    await s.update("saved.json", a.revision, { seed: 9 });
    const result = await s.executeBatch(prepared);
    expect(result.ok).toBe(false);
    expect(result.results[0].status).toBe("failed");
    expect((await s.store.read("saved.json")).project.seed).toBe(9);
    expect(await readdir(root)).not.toContain("bad.json");
    expect(await readFile(join(root, "saved.json"))).not.toEqual(before);
  });
  it("rejects duplicate aliases and reports an output collision before editing", async () => {
    await expect(
      s.prepareBatch([
        { action: "create", file: "a.json" },
        { action: "create", file: "./a.json" },
      ]),
    ).rejects.toThrow("distinct");
    expect(await readdir(root)).toEqual([]);
    const a = await s.create("saved.json");
    await writeFile(join(root, "occupied"), "keep");
    const b = await s.prepareBatch([
      {
        action: "edit",
        file: "saved.json",
        revision: a.revision,
        edits: [{ action: "update_project", patch: { seed: 5 } }],
        out: "occupied",
      },
    ]);
    expect(b.results[0].status).toBe("failed");
    expect((await s.store.read("saved.json")).revision).toBe(a.revision);
  });
  it("cancels pending creates without removing completed projects", async () => {
    const prepared = await s.prepareBatch([
        { action: "create", file: "a.json" },
        { action: "create", file: "b.json" },
      ]),
      abort = new AbortController();
    const result = await s.executeBatch(prepared, abort.signal, (completed) => {
      if (completed === 1) abort.abort();
    });
    expect(result.results.map((r) => r.status)).toEqual([
      "succeeded",
      "cancelled",
    ]);
    expect(await readdir(root)).toEqual(["a.json"]);
  });
  it("retains a written project and reports partial when the export destination appears after preflight", async () => {
    const prepared = await s.prepareBatch([
      {
        action: "create",
        file: "new.json",
        out: "race",
        options: { format: "gif" },
      },
    ]);
    await writeFile(join(root, "race"), "existing user file");
    const result = await s.executeBatch(prepared);
    expect(result.ok).toBe(false);
    expect(result.results[0].status).toBe("partial");
    expect((await s.store.read("new.json")).revision).toBe(
      result.results[0].revision,
    );
    expect(await readFile(join(root, "race"), "utf8")).toBe(
      "existing user file",
    );
  });
});
