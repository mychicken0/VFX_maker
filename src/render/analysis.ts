import { parseProject, type Project } from "../core/model.js";
import {
  analysisSchema,
  analysisTimes,
  type AnalysisInput,
  type AnalysisReport,
  type AnalysisFrame,
} from "../core/analysis.js";
import { pixelMetrics } from "../core/observation.js";
import type { VfxRenderer } from "./pixi.js";
async function hash(bytes: Uint8ClampedArray) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
export async function analyze(
  renderer: VfxRenderer,
  value: Project,
  input: AnalysisInput = {},
): Promise<AnalysisReport> {
  const p = parseProject(value),
    o = analysisSchema.parse(input),
    times = analysisTimes(p, o);
  await renderer.setProject(p);
  const frames: AnalysisFrame[] = [];
  for (const time of times) {
    renderer.render(time);
    const pixels = renderer.pixels();
    frames.push({
      time,
      frameIndex: time < p.duration ? Math.floor(time * p.fps + 1e-8) : null,
      sha256: await hash(pixels),
      ...pixelMetrics(pixels, p.canvas.width, p.canvas.height),
    });
  }
  const mismatches: AnalysisReport["parity"]["mismatches"] = [];
  if (o.parity)
    for (const frame of [...frames].reverse()) {
      renderer.render(frame.time);
      const actual = await hash(renderer.pixels());
      if (frame.sha256 !== actual)
        mismatches.push({ time: frame.time, expected: frame.sha256, actual });
    }
  const visible = frames.filter((f) => f.visiblePixels),
    byTime = [...visible].sort((a, b) => a.time - b.time),
    peakMass = visible.reduce<AnalysisFrame | null>(
      (best, f) => (!best || f.alphaMass > best.alphaMass ? f : best),
      null,
    ),
    peakPixels = visible.reduce<AnalysisFrame | null>(
      (best, f) => (!best || f.visiblePixels > best.visiblePixels ? f : best),
      null,
    );
  return {
    kind: "vfx-analysis",
    formatVersion: 1,
    canvas: { width: p.canvas.width, height: p.canvas.height },
    duration: p.duration,
    fps: p.fps,
    frames,
    summary: {
      sampledFrames: frames.length,
      visibleFrames: visible.length,
      emptyFrames: frames.length - visible.length,
      firstVisibleTime: byTime[0]?.time ?? null,
      lastVisibleTime: byTime.at(-1)?.time ?? null,
      peakAlphaMass: peakMass
        ? { time: peakMass.time, value: peakMass.alphaMass }
        : null,
      peakVisiblePixels: peakPixels
        ? { time: peakPixels.time, value: peakPixels.visiblePixels }
        : null,
      edgeTimes: frames.filter((f) => f.touches.length).map((f) => f.time),
    },
    parity: {
      checked: o.parity,
      passed: o.parity ? !mismatches.length : null,
      order: "reverse",
      mismatches,
    },
  };
}
