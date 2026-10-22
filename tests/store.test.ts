import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, merge } from "../src/node/store.js";
import { Service } from "../src/node/service.js";
import { getPreset } from "../src/core/presets.js";
import { Jobs } from "../src/node/jobs.js";
let dir: string, s: Service;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vfx-ไทย "));
  s = new Service(await Store.open(dir));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
describe("portable projects and edits", () => {
  it("creates, edits with nested merging, rejects stale revisions and never clobbers a project", async () => {
    const a = await s.create("a.json", { preset: "spark_burst" });
    await expect(s.create("a.json")).rejects.toThrow("exists");
    const b = await s.updateLayer("a.json", a.revision, "sparks", {
      spawn: { shape: "ring" },
      count: 17,
    });
    expect(b.project.layers[1]).toMatchObject({
      count: 17,
      spawn: { shape: "ring", radius: 10 },
    });
    await expect(s.update("a.json", a.revision, { seed: 3 })).rejects.toThrow(
      "Revision conflict",
    );
    const before = await readFile(join(dir, "a.json"));
    await expect(
      s.update("a.json", b.revision, { canvas: { width: 9000 } }),
    ).rejects.toThrow();
    expect(await readFile(join(dir, "a.json"))).toEqual(before);
  });
  it("serializes concurrent edits with one winner and preserves unknown user files", async () => {
    const a = await s.create("a.json");
    const results = await Promise.allSettled([
      s.update("a.json", a.revision, { seed: 7 }),
      s.update("a.json", a.revision, { seed: 8 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect([7, 8]).toContain((await s.store.read("a.json")).project.seed);
    await writeFile(join(dir, "keep.txt"), "keep");
    await expect(
      s.store.publish("keep.txt", { x: Buffer.from("x") }),
    ).rejects.toThrow();
    expect(await readFile(join(dir, "keep.txt"), "utf8")).toBe("keep");
  });
  it("rejects traversal and symlink escapes and confines publication", async () => {
    await expect(s.store.path("../outside", false)).rejects.toThrow("inside");
    await symlink(tmpdir(), join(dir, "escape"));
    await expect(s.store.path("escape/new.json", false)).rejects.toThrow(
      "symlink",
    );
    await expect(s.store.path("escape", true)).rejects.toThrow("symlink");
    await expect(
      s.store.publish("out", { "../escape.txt": Buffer.from("bad") }),
    ).rejects.toThrow("member");
    await expect(
      readFile(join(dir, "out", ".vfx-exporting")),
    ).rejects.toThrow();
    const abort = new AbortController();
    abort.abort();
    await expect(s.store.publish("cancel", {}, abort.signal)).rejects.toThrow();
  });
  it("imports a portable flipbook and checks asset references on deletion", async () => {
    const p = getPreset("flipbook_burst"),
      a = await s.create("a.json", {
        project: { ...p, assets: [], layers: [] },
      });
    await writeFile(
      join(dir, "sheet.png"),
      Buffer.from(p.assets[0].data.split(",")[1], "base64"),
    );
    const b = await s.importAsset("a.json", a.revision, "sheet.png", {
      id: "sheet",
      columns: 3,
      rows: 2,
      frames: 6,
    });
    await rm(join(dir, "sheet.png"));
    expect(b.project.assets[0].frames).toBe(6);
    const c = await s.addLayer("a.json", b.revision, {
      id: "sprite",
      name: "Sprite",
      type: "sprite",
      asset: "sheet",
    });
    await expect(
      s.update("a.json", c.revision, { assets: [] }),
    ).rejects.toThrow("existing sprite");
    expect((await s.store.read("a.json")).project.assets[0].data).toBe(
      p.assets[0].data,
    );
  });
  it("reorders without losing layers and protects locked layers", async () => {
    const a = await s.create("a.json", { preset: "spark_burst" }),
      b = await s.reorder("a.json", a.revision, ["sparks", "shockwave"]);
    expect(b.project.layers[0].id).toBe("sparks");
    await expect(
      s.reorder("a.json", b.revision, ["sparks", "sparks"]),
    ).rejects.toThrow("exactly once");
    const c = await s.updateLayer("a.json", b.revision, "sparks", {
      locked: true,
    });
    await expect(s.removeLayer("a.json", c.revision, "sparks")).rejects.toThrow(
      "Unlock",
    );
    await expect(
      s.update(
        "a.json",
        c.revision,
        JSON.parse('{"__proto__":{"polluted":true}}'),
      ),
    ).rejects.toThrow("Invalid property");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(
      merge({ a: [1], b: { x: 1, y: 2 } }, { a: [2, 3], b: { x: 7 } }),
    ).toEqual({ a: [2, 3], b: { x: 7, y: 2 } });
  });
});
describe("managed exports", () => {
  it("queues one worker, reports progress and cancels queued work", async () => {
    const jobs = new Jobs();
    let finish!: () => void;
    const running = new Promise<void>((resolve) => (finish = resolve));
    const a = jobs.start(async (_, progress) => {
      progress(2, 10);
      await running;
      return "done";
    });
    const b = jobs.start(async () => "must not run");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(jobs.get(a.id)).toMatchObject({ status: "running", completed: 2 });
    jobs.cancel(b.id);
    finish();
    await jobs.close();
    expect(jobs.get(a.id).status).toBe("succeeded");
    expect(jobs.get(b.id).status).toBe("cancelled");
  });
});
