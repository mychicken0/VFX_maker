import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/node/store.js";
import { serve } from "../src/node/server.js";
import { getPreset } from "../src/core/presets.js";
let dir: string, store: Store, server: Awaited<ReturnType<typeof serve>>;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vfx-doc-"));
  store = await Store.open(dir);
  const created = await store.create("effect.vfx.json", getPreset());
  server = await serve({
    webRoot: dir,
    project: created.project,
    document: { store, file: "effect.vfx.json" },
  });
});
afterEach(async () => {
  await server.close();
  await rm(dir, { recursive: true, force: true });
});
const request = (
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
) =>
  fetch(server.url + "/api/" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${server.token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...extra,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
it("authenticates file operations and refuses stale revisions, foreign origins and existing Save As paths", async () => {
  const doc = await (await request("document")).json();
  expect((await fetch(server.url + "/api/document")).status).toBe(403);
  const changed = { ...doc.project, seed: 45 },
    body = { project: changed, revision: doc.revision, documentId: doc.id };
  expect(
    (await request("save", body, { Origin: "http://untrusted.example" }))
      .status,
  ).toBe(400);
  const saved = await (await request("save", body)).json();
  expect(saved.project.seed).toBe(45);
  expect((await request("save", body)).status).toBe(409);
  expect((await store.read("effect.vfx.json")).project.seed).toBe(45);
  const backup = await (await request("backups")).json();
  expect(backup).toHaveLength(1);
  const restored = await (
    await request("restore", {
      documentId: doc.id,
      revision: saved.revision,
      id: backup[0].id,
    })
  ).json();
  expect(restored.project.seed).toBe(doc.project.seed);
  expect(
    (
      await request("save-as", {
        documentId: doc.id,
        file: "effect.vfx.json",
        project: changed,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await request("save-as", {
        documentId: doc.id,
        file: "../outside.json",
        project: changed,
      })
    ).status,
  ).toBe(400);
  expect((await store.read("effect.vfx.json")).project.seed).toBe(
    doc.project.seed,
  );
});
it("switches Save As to the new file and prevents an older tab from writing to that binding", async () => {
  const doc = await (await request("document")).json(),
    before = await readFile(join(dir, "effect.vfx.json"), "utf8");
  const saved = await (
    await request("save-as", {
      documentId: doc.id,
      file: "new.vfx.json",
      project: doc.project,
    })
  ).json();
  expect(saved.file).toBe("new.vfx.json");
  expect(saved.id).not.toBe(doc.id);
  expect(
    (
      await request("save", {
        documentId: doc.id,
        revision: saved.revision,
        project: { ...doc.project, seed: 9 },
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await request("save", {
        documentId: saved.id,
        revision: saved.revision,
        project: { ...doc.project, seed: 8 },
      })
    ).status,
  ).toBe(200);
  expect((await store.read("new.vfx.json")).project.seed).toBe(8);
  expect(await readFile(join(dir, "effect.vfx.json"), "utf8")).toBe(before);
});
