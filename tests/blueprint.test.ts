import { describe, it, expect } from "vitest";
import {
  applyEdits,
  connectControl,
  describeBlueprint,
  disconnectControl,
  editPathPoints,
  getPreset,
  parseProject,
  resolveControls,
  controlSchema,
} from "../src/core/index.js";

describe("shared Blueprint operations", () => {
  const source = () => {
    const p = getPreset();
    p.controls = [
      ...p.controls,
      controlSchema.parse({
        id: "turn",
        name: "Turn",
        value: 30,
        min: -180,
        max: 180,
      }),
    ];
    return p;
  };
  it("connects typed ports without baking controls into the base and roundtrips node positions", () => {
    const p = source(),
      base = structuredClone(p);
    const changed = applyEdits(p, [
      {
        action: "connect_control",
        control: "turn",
        layer: "cut-a",
        target: "rotation",
        mode: "add",
      },
    ]);
    expect(changed.layers).toEqual(base.layers);
    expect(resolveControls(changed).layers[0].rotation).toBe(
      base.layers[0].rotation + 30,
    );
    expect(p).toEqual(base);
    const described = describeBlueprint(changed);
    expect(described.layers[0].inputs.some((v) => v.path === "rotation")).toBe(
      true,
    );
    const connection = described.connections.find((v) => v.control === "turn")!;
    expect(connection.disconnectEdit).toEqual({
      action: "disconnect_control",
      control: "turn",
      index: 0,
    });
    expect(
      applyEdits(changed, [connection.disconnectEdit]).controls.at(-1)
        ?.bindings,
    ).toEqual([]);
    const roundtrip = parseProject(
      JSON.parse(
        JSON.stringify({
          ...changed,
          editor: { blueprint: { "layer:cut-a": { x: 720, y: -240 } } },
        }),
      ),
    );
    expect(roundtrip.editor.blueprint?.["layer:cut-a"]).toEqual({
      x: 720,
      y: -240,
    });
  });
  it("rejects duplicate, nonexistent and locked ports, and reports the failed atomic operation", () => {
    const p = source(),
      c = connectControl(p, "turn", "cut-a", "rotation", { mode: "add" });
    expect(() => connectControl(c, "turn", "cut-a", "rotation")).toThrow(
      "already connected",
    );
    expect(() => connectControl(p, "turn", "cut-a", "__proto__.evil")).toThrow(
      "Unknown parameter",
    );
    expect(() => connectControl(p, "missing", "cut-a", "scale")).toThrow(
      "existing",
    );
    const locked = structuredClone(c);
    locked.layers[0].locked = true;
    expect(() => connectControl(locked, "turn", "cut-a", "position.x")).toThrow(
      "Unlock",
    );
    expect(() => disconnectControl(locked, "turn", 0)).toThrow("Unlock");
    const before = structuredClone(p);
    expect(() =>
      applyEdits(p, [
        {
          action: "connect_control",
          control: "turn",
          layer: "cut-a",
          target: "rotation",
          mode: "add",
        },
        {
          action: "connect_control",
          control: "turn",
          layer: "cut-a",
          target: "not-a-port",
        },
      ]),
    ).toThrow("Operation 2");
    expect(p).toEqual(before);
  });
  it("transforms curve keys and validates resulting budget rather than accepting an invalid graph", () => {
    const p = source();
    expect(() => connectControl(p, "turn", "cut-a", "scale")).toThrow();
    const c = connectControl(p, "turn", "cut-a", "width", {
      mode: "multiply",
      factor: 0.05,
    });
    const before = p.layers[0],
      after = resolveControls(c).layers[0];
    if (before.type !== "path" || after.type !== "path")
      throw Error("Expected path");
    expect(after.width.map((k) => k.value)).toEqual(
      before.width.map((k) => k.value * 1.5),
    );
  });
  it("keeps anchors and handles aligned for insert/delete/smooth/corner edits", () => {
    const p = source(),
      layer = p.layers[0];
    if (layer.type !== "path") throw Error("Expected path");
    const smooth = editPathPoints(layer, 1, "smooth");
    expect(smooth.handles).toHaveLength(smooth.points.length);
    const insert = editPathPoints(smooth, 1, "insert"),
      removed = editPathPoints(insert, 2, "remove");
    expect(removed).toEqual(smooth);
    const corner = editPathPoints(removed, 1, "corner");
    expect(corner.handles?.[1]).toEqual({
      in: { x: 0, y: 0 },
      out: { x: 0, y: 0 },
    });
    expect(
      applyEdits(p, [
        {
          action: "edit_path_point",
          id: layer.id,
          index: 1,
          operation: "smooth",
        },
      ]).layers[0],
    ).toEqual(smooth);
    expect(layer.handles).toBeUndefined();
    expect(() =>
      editPathPoints(
        { ...layer, points: layer.points.slice(0, 2) },
        0,
        "remove",
      ),
    ).toThrow("two");
  });
  it("opens 0.7.3 files without changing base effect values", () => {
    const p = source(),
      opened = parseProject({ ...p, version: "0.7.3" });
    expect(opened.version).toBe("0.7.4");
    expect(opened.layers).toEqual(p.layers);
  });
});
