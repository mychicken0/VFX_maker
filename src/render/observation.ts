import { resolveControls } from "../core/parameters.js";
import { encodePng, type Bitmap } from "../core/pixels.js";
import { parseProject, type Project } from "../core/model.js";
import {
  candidateTimes,
  timelineTimes,
  observationSchema,
  validateObservation,
  describeScene,
  pixelMetrics,
  type ObservationInput,
  type ObservationReport,
  type ObservationOptions,
  type ObservedFrame,
  type ObservationTile,
} from "../core/observation.js";
import type { VfxRenderer } from "./pixi.js";

type Panel = { bitmap: Bitmap; image: string; time: number; layer?: string };
function bitmapCanvas(bitmap: Bitmap) {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas
    .getContext("2d")!
    .putImageData(
      new ImageData(
        new Uint8ClampedArray(bitmap.rgba),
        bitmap.width,
        bitmap.height,
      ),
      0,
      0,
    );
  return canvas;
}
const colors = [
  "#bba2ff",
  "#ffb86b",
  "#69dfcf",
  "#ff7b9c",
  "#91bdff",
  "#d9e382",
  "#dba4ff",
  "#7fe0a1",
  "#f1c4a3",
];
const ink = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
) => {
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#10121b";
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
};
function shorten(text: string, limit: number) {
  return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
}
function fitText(ctx: CanvasRenderingContext2D, text: string, width: number) {
  let result = text;
  while (result.length > 1 && ctx.measureText(result).width > width)
    result = result.slice(0, -1);
  return result === text ? text : result.slice(0, -1) + "…";
}
async function compose(
  project: Project,
  report: ObservationReport,
  panels: Panel[],
  o: ObservationOptions,
) {
  const crop = o.crop ?? {
    x: 0,
    y: 0,
    width: project.canvas.width,
    height: project.canvas.height,
  };
  const cols =
      panels.length <= 2 ? panels.length : Math.ceil(Math.sqrt(panels.length)),
    rows = Math.ceil(panels.length / cols);
  const annotationLayers = report.layers
    .filter((l) => l.pixels.visiblePixels)
    .slice(-9);
  const legend = o.guides && annotationLayers.length ? 180 : 0;
  let reference: HTMLImageElement | undefined;
  if (report.reference.displayed) {
    reference = new Image();
    reference.src = project.editor.reference!.image.data;
    await reference.decode();
  }
  const sources = panels.map((p) => bitmapCanvas(p.bitmap));
  let scale = o.scale ?? (o.view === "frame" ? 3 : 2);
  const columnWidth = () => Math.max(150, crop.width * scale) + 48;
  const dimensions = () => ({
    width: Math.max(
      240 + legend,
      Math.ceil(cols * columnWidth() + legend + 16),
    ),
    height: Math.ceil(
      Math.max(
        rows * (crop.height * scale + 52),
        annotationLayers.length * 32 + 84,
      ) + 44,
    ),
  });
  while (
    dimensions().width > 1536 ||
    dimensions().height > 1536 ||
    dimensions().width * dimensions().height > 1048576
  )
    scale *= 0.85;
  if (scale >= 1) scale = Math.floor(scale);
  for (let attempt = 0; attempt < 10; attempt++) {
    const { width, height } = dimensions(),
      canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#141620";
    ctx.fillRect(0, 0, width, height);
    ctx.font = "bold 14px sans-serif";
    ctx.fillStyle = "#f1ecff";
    ctx.fillText(
      fitText(
        ctx,
        `${report.draft ? "DRAFT · " : ""}${project.name} · ${o.view}`,
        width - 28,
      ),
      14,
      22,
    );
    const tiles: ObservationTile[] = [];
    for (const [i, panel] of panels.entries()) {
      const x = 8 + (i % cols) * columnWidth(),
        y = 36 + Math.floor(i / cols) * (crop.height * scale + 52);
      const viewport = {
        x: x + 30,
        y: y + 20,
        width: crop.width * scale,
        height: crop.height * scale,
      };
      tiles.push({
        image: panel.image,
        time: panel.time,
        layer: panel.layer,
        viewport,
        crop,
        pixelsPerCanvasPixel: scale,
      });
      ctx.font = "12px sans-serif";
      ctx.fillStyle = "#e5e0f2";
      const caption = panel.layer
        ? `${report.layers.find((l) => l.id === panel.layer)!.order + 1}. ${shorten(panel.layer, 26)} · ${panel.time.toFixed(3)}s`
        : `${panel.time.toFixed(3)}s · frame ${Math.floor(panel.time * project.fps)}${Math.abs(panel.time - report.time) < 1e-8 ? " · focus" : ""}`;
      ctx.fillText(
        fitText(
          ctx,
          caption,
          cols === 1 ? width - legend - x - 38 : columnWidth() - 36,
        ),
        x + 30,
        y + 12,
      );
      ctx.save();
      ctx.beginPath();
      ctx.rect(viewport.x, viewport.y, viewport.width, viewport.height);
      ctx.clip();
      if (o.background !== "transparent") {
        ctx.fillStyle = "#10121b";
        ctx.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
        if (o.background === "checker") {
          ctx.fillStyle = "#232531";
          for (let py = 0; py < viewport.height; py += 12)
            for (let px = 0; px < viewport.width; px += 12)
              if ((Math.floor(px / 12) + Math.floor(py / 12)) % 2 === 0)
                ctx.fillRect(viewport.x + px, viewport.y + py, 12, 12);
        }
      } else {
        ctx.clearRect(viewport.x, viewport.y, viewport.width, viewport.height);
      }
      ctx.translate(viewport.x - crop.x * scale, viewport.y - crop.y * scale);
      ctx.scale(scale, scale);
      const drawReference = () => {
        const ref = project.editor.reference!;
        if (!reference) return;
        ctx.save();
        ctx.globalAlpha = ref.opacity;
        ctx.drawImage(
          reference,
          ref.position.x - (ref.image.width * ref.scale) / 2,
          ref.position.y - (ref.image.height * ref.scale) / 2,
          ref.image.width * ref.scale,
          ref.image.height * ref.scale,
        );
        ctx.restore();
      };
      if (reference && project.editor.reference!.plane === "behind")
        drawReference();
      ctx.drawImage(sources[i], 0, 0);
      if (reference && project.editor.reference!.plane === "above")
        drawReference();
      const step =
        [1, 2, 4, 8, 16, 32, 64, 128, 256].find(
          (n) =>
            n >= Math.max(Math.max(crop.width, crop.height) / 4, 24 / scale),
        ) ?? 256;
      if (o.grid) {
        ctx.lineWidth = 1 / scale;
        ctx.strokeStyle = "#a7b0d133";
        ctx.beginPath();
        for (
          let px = Math.ceil(crop.x / step) * step;
          px <= crop.x + crop.width;
          px += step
        ) {
          ctx.moveTo(px, crop.y);
          ctx.lineTo(px, crop.y + crop.height);
        }
        for (
          let py = Math.ceil(crop.y / step) * step;
          py <= crop.y + crop.height;
          py += step
        ) {
          ctx.moveTo(crop.x, py);
          ctx.lineTo(crop.x + crop.width, py);
        }
        ctx.stroke();
      }
      if (o.guides && Math.abs(panel.time - report.time) < 1e-8)
        for (const l of annotationLayers.filter(
          (l) => !panel.layer || panel.layer === l.id,
        )) {
          const b = l.pixels.bounds!,
            color = colors[l.order % colors.length];
          ctx.lineWidth = 1 / scale;
          ctx.strokeStyle = color;
          ctx.strokeRect(b.x, b.y, b.width, b.height);
          const a = l.transform.anchor;
          ctx.beginPath();
          ctx.moveTo(a.x - 4 / scale, a.y);
          ctx.lineTo(a.x + 4 / scale, a.y);
          ctx.moveTo(a.x, a.y - 4 / scale);
          ctx.lineTo(a.x, a.y + 4 / scale);
          ctx.stroke();
          ctx.font = `bold ${12 / scale}px sans-serif`;
          ctx.fillStyle = color;
          // Bounds describe the representative time, so only draw them at that time.
          if (Math.abs(panel.time - report.time) < 1e-8)
            ink(ctx, String(l.order + 1), b.x + 2 / scale, b.y + 11 / scale);
        }
      if (o.point) {
        ctx.strokeStyle = "#fff89b";
        ctx.lineWidth = 2 / scale;
        ctx.beginPath();
        ctx.arc(o.point.x, o.point.y, 5 / scale, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = "#555c73";
      ctx.lineWidth = 1;
      ctx.strokeRect(viewport.x, viewport.y, viewport.width, viewport.height);
      ctx.font = "10px monospace";
      ctx.fillStyle = "#aeb7ce";
      for (
        let px = Math.ceil(crop.x / step) * step;
        px <= crop.x + crop.width;
        px += step
      )
        ctx.fillText(
          String(px),
          viewport.x + (px - crop.x) * scale - 7,
          viewport.y + viewport.height + 14,
        );
      for (
        let py = Math.ceil(crop.y / step) * step;
        py <= crop.y + crop.height;
        py += step
      )
        ctx.fillText(String(py), x, viewport.y + (py - crop.y) * scale + 3);
    }
    if (legend) {
      const x = width - legend + 2;
      ctx.font = "bold 11px sans-serif";
      ctx.fillStyle = "#d0c8e6";
      ctx.fillText(`IDs at ${report.time.toFixed(3)}s`, x, 48);
      for (const [i, l] of annotationLayers.entries()) {
        ctx.font = "bold 12px sans-serif";
        ctx.fillStyle = colors[l.order % colors.length];
        ctx.fillText(`${l.order + 1}. ${shorten(l.id, 21)}`, x, 72 + i * 32);
        ctx.font = "10px sans-serif";
        ctx.fillStyle = "#a8a9bc";
        ctx.fillText(shorten(l.name, 25), x, 85 + i * 32);
      }
      ctx.font = "10px sans-serif";
      ctx.fillStyle = "#a8a9bc";
      ctx.fillText(
        "Original canvas pixels",
        x,
        100 + annotationLayers.length * 32,
      );
    }
    const rgba = ctx.getImageData(0, 0, width, height).data,
      png = encodePng({ width, height, rgba });
    if (png.length <= 2 * 1024 * 1024) return { png, width, height, tiles };
    scale *= 0.8;
  }
  throw Error(
    "Observation image exceeds 2 MiB; choose fewer times/layers or a crop",
  );
}

/** Real renderer samples, isolated alpha bounds and an annotated inspection sheet. */
export async function observe(
  renderer: VfxRenderer,
  value: Project,
  input: ObservationInput = {},
  draft = false,
) {
  const source = parseProject(value),
    o = observationSchema.parse(input);
  validateObservation(source, o);
  const resolved = resolveControls(source),
    scope = o.ids ? new Set(o.ids) : undefined;
  await renderer.setProject(source);
  const crop = o.crop ?? {
    x: 0,
    y: 0,
    width: source.canvas.width,
    height: source.canvas.height,
  };
  const frames = new Map<number, { bitmap: Bitmap; metrics: ObservedFrame }>();
  const sample = (time: number) => {
    const cached = frames.get(time);
    if (cached) return cached;
    renderer.render(time, scope);
    const bitmap = {
      width: source.canvas.width,
      height: source.canvas.height,
      rgba: renderer.pixels(),
    };
    const data = {
      bitmap,
      metrics: {
        time,
        frameIndex:
          time < source.duration ? Math.floor(time * source.fps + 1e-8) : null,
        ...pixelMetrics(bitmap.rgba, bitmap.width, bitmap.height),
        cropPixels: pixelMetrics(bitmap.rgba, bitmap.width, bitmap.height, crop)
          .visiblePixels,
      },
    };
    frames.set(time, data);
    return data;
  };
  const automatic = o.time === undefined && o.times === undefined;
  const sampledTimes = automatic
    ? candidateTimes(source)
    : (o.times ?? [o.time!]);
  let bestTime = sampledTimes[0],
    bestMass = -1;
  for (const time of sampledTimes) {
    const mass = sample(time).metrics.alphaMass;
    if (mass > bestMass) {
      bestMass = mass;
      bestTime = time;
    }
  }
  let shownTimes =
    o.view === "storyboard"
      ? (o.times ?? timelineTimes(source))
      : [o.time ?? bestTime];
  const activeTimes = sampledTimes.filter(
    (t) => sample(t).metrics.visiblePixels > 0,
  );
  if (
    automatic &&
    o.view === "storyboard" &&
    o.storyboardMode === "active" &&
    activeTimes.length
  ) {
    // Show distributed measured activity, keeping the real timestamps visible.
    const count = Math.min(6, activeTimes.length);
    shownTimes = Array.from(
      { length: count },
      (_, i) =>
        activeTimes[
          count === 1
            ? 0
            : Math.round((i * (activeTimes.length - 1)) / (count - 1))
        ],
    );
  }
  if (automatic && o.view === "storyboard" && !shownTimes.includes(bestTime)) {
    const at =
      shownTimes.length > 2 ? 1 + Math.floor((shownTimes.length - 2) / 2) : 0;
    shownTimes = [...shownTimes];
    shownTimes[at] = bestTime;
    shownTimes.sort((a, b) => a - b);
  }
  const focalTime = o.time ?? bestTime;
  const scene = describeScene(source, resolved, focalTime, o.ids),
    warnings: ObservationReport["warnings"] = [],
    isolated = new Map<string, Bitmap>();
  const sheetIds = new Set(scene.layers.slice(-9).map((l) => l.id));
  const layers = scene.layers.map((l) => {
    renderer.render(focalTime, new Set([l.id]));
    const bitmap = {
        width: source.canvas.width,
        height: source.canvas.height,
        rgba: renderer.pixels(),
      },
      pixels = pixelMetrics(bitmap.rgba, bitmap.width, bitmap.height),
      geometryBounds = renderer.geometryBounds(l.id);
    if (o.view === "layers" && sheetIds.has(l.id)) isolated.set(l.id, bitmap);
    let state = !l.visible
      ? "hidden"
      : !l.timing.active
        ? focalTime < l.timing.start
          ? "not-started"
          : "ended"
        : pixels.visiblePixels
          ? "visible"
          : geometryBounds &&
              (geometryBounds.x >= bitmap.width ||
                geometryBounds.y >= bitmap.height ||
                geometryBounds.x + geometryBounds.width <= 0 ||
                geometryBounds.y + geometryBounds.height <= 0)
            ? "outside-canvas"
            : "no-visible-pixels-at-this-time";
    const pickAlpha = o.point
      ? bitmap.rgba[
          (Math.floor(o.point.y) * bitmap.width + Math.floor(o.point.x)) * 4 + 3
        ]
      : undefined;
    return {
      ...l,
      pixels,
      geometryBounds,
      state,
      ...(pickAlpha === undefined ? {} : { pickAlpha }),
    };
  });
  const ref = source.editor.reference;
  const report: ObservationReport = {
    ...scene,
    view: o.view,
    draft,
    layers,
    frames: shownTimes.map((time) => sample(time).metrics),
    sampling: {
      automatic,
      times: sampledTimes,
      basis:
        "largest rendered alpha mass among sampled times; not an exhaustive proof of visibility",
      storyboardMode: o.storyboardMode,
      emptySamplesOmitted:
        automatic &&
        o.view === "storyboard" &&
        o.storyboardMode === "active" &&
        activeTimes.length
          ? sampledTimes.length - activeTimes.length
          : 0,
    },
    reference: {
      displayed: !!(o.includeReference && ref?.visible && ref.opacity),
      excludedFromPixels: true,
      ...(ref
        ? {
            name: ref.image.name,
            position: ref.position,
            scale: ref.scale,
            plane: ref.plane,
          }
        : {}),
    },
    ...(o.point
      ? {
          point: o.point,
          hits: layers
            .filter(
              (l) =>
                l.pickAlpha !== undefined && l.pickAlpha >= o.point!.threshold,
            )
            .sort((a, b) => b.order - a.order)
            .map((l) => l.id),
        }
      : {}),
    warnings,
    images: [],
    tiles: [],
    omittedLayerIds: [],
  };
  if (!sample(focalTime).metrics.visiblePixels)
    warnings.push({
      code: "EMPTY_FRAME",
      message: automatic
        ? "No visible pixels at sampled times. Inspect layer timing/visibility/controls, or request an explicit time; unsampled moments may still contain pixels."
        : "The requested frame is empty. Inspect layer states or request an automatic observation to find a visible time.",
    });
  if (
    o.crop &&
    !sample(focalTime).metrics.cropPixels &&
    sample(focalTime).metrics.visiblePixels
  )
    warnings.push({
      code: "EMPTY_CROP",
      message:
        "The effect has pixels elsewhere on the canvas; this crop is empty.",
    });
  const edges = layers.filter((l) => l.pixels.touches.length).map((l) => l.id);
  if (edges.length)
    warnings.push({
      code: "TOUCHES_EDGE",
      message:
        "Isolated rendered pixels touch a canvas edge; check framing before export. Edge contact alone does not prove clipping.",
      ids: edges,
    });
  const outside = layers
    .filter((l) => l.state === "outside-canvas")
    .map((l) => l.id);
  if (outside.length)
    warnings.push({
      code: "OUTSIDE_CANVAS",
      message: "These active layers' geometry lies outside the canvas.",
      ids: outside,
    });
  const files: Record<string, Uint8Array> = {},
    panels: Panel[] = [];
  if (o.view === "layers") {
    for (const [i, l] of layers.slice(-9).entries()) {
      const name = `layer-${i}.png`,
        bitmap = isolated.get(l.id)!;
      files[name] = encodePng(bitmap);
      report.images.push({
        name,
        role: "layer",
        width: bitmap.width,
        height: bitmap.height,
        time: focalTime,
        layer: l.id,
      });
      panels.push({ bitmap, image: name, layer: l.id, time: focalTime });
    }
    report.omittedLayerIds = layers.slice(0, -9).map((l) => l.id);
    if (report.omittedLayerIds.length)
      warnings.push({
        code: "LAYER_SHEET_LIMIT",
        message:
          "The sheet shows the top nine scoped layers. Supply ids to inspect other layers.",
        ids: report.omittedLayerIds,
      });
  } else
    for (const [i, time] of shownTimes.entries()) {
      const name = `frame-${i}.png`,
        bitmap = sample(time).bitmap;
      files[name] = encodePng(bitmap);
      report.images.push({
        name,
        role: "frame",
        width: bitmap.width,
        height: bitmap.height,
        time,
      });
      panels.push({ bitmap, image: name, time });
    }
  // An empty project still has an observable frame and a coordinate system.
  if (!panels.length) {
    const name = "frame-0.png",
      bitmap = sample(focalTime).bitmap;
    files[name] = encodePng(bitmap);
    report.images.push({
      name,
      role: "frame",
      width: bitmap.width,
      height: bitmap.height,
      time: focalTime,
    });
    panels.push({ bitmap, image: name, time: focalTime });
  }
  try {
    const composed = await compose(source, report, panels, o);
    files["observation.png"] = composed.png;
    report.tiles = composed.tiles;
    report.images.unshift({
      name: "observation.png",
      role: "annotated",
      width: composed.width,
      height: composed.height,
    });
    return { report, files };
  } finally {
    renderer.render(focalTime, scope);
  }
}
