import { z } from "zod";
import { type Project } from "./model.js";
import { type PixelMetrics } from "./observation.js";
export const analysisSchema = z
  .object({
    times: z
      .array(z.number().finite().min(0).max(10))
      .min(1)
      .max(300)
      .optional(),
    parity: z.boolean().default(true),
  })
  .strict();
export type AnalysisInput = z.input<typeof analysisSchema>;
export function analysisTimes(p: Project, input: AnalysisInput = {}) {
  const options = analysisSchema.parse(input);
  if (options.times?.some((t) => t > p.duration))
    throw Error("Analysis time is outside the effect duration");
  const times =
    options.times ??
    Array.from(
      { length: Math.ceil(p.duration * p.fps - 1e-9) },
      (_, i) => i / p.fps,
    );
  if (new Set(times).size !== times.length)
    throw Error("Analysis times must be distinct");
  if (times.length * p.canvas.width * p.canvas.height > 16777216)
    throw Error("Analysis exceeds 16777216 source pixels; choose fewer times");
  return times;
}
const frame = z
  .object({
    time: z.number().finite().min(0).max(10),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .passthrough();
export const analysisBaselineSchema = z
  .object({
    kind: z.literal("vfx-analysis"),
    formatVersion: z.literal(1),
    canvas: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .passthrough(),
    frames: z.array(frame).min(1).max(300),
  })
  .passthrough();
export interface AnalysisFrame extends PixelMetrics {
  time: number;
  frameIndex: number | null;
  sha256: string;
}
export interface AnalysisReport {
  kind: "vfx-analysis";
  formatVersion: 1;
  canvas: { width: number; height: number };
  duration: number;
  fps: number;
  frames: AnalysisFrame[];
  summary: {
    sampledFrames: number;
    visibleFrames: number;
    emptyFrames: number;
    firstVisibleTime: number | null;
    lastVisibleTime: number | null;
    peakAlphaMass: { time: number; value: number } | null;
    peakVisiblePixels: { time: number; value: number } | null;
    edgeTimes: number[];
  };
  parity: {
    checked: boolean;
    passed: boolean | null;
    order: "reverse";
    mismatches: { time: number; expected: string; actual: string }[];
  };
}
export function compareAnalysis(actual: AnalysisReport, value: unknown) {
  const baseline = analysisBaselineSchema.parse(value),
    expected = new Map(baseline.frames.map((f) => [f.time, f.sha256]));
  if (expected.size !== baseline.frames.length)
    throw Error("Baseline times must be distinct");
  const dimensionMatch =
    actual.canvas.width === baseline.canvas.width &&
    actual.canvas.height === baseline.canvas.height;
  const frames = actual.frames.filter((f) => expected.has(f.time)),
    missingTimes = baseline.frames
      .filter((f) => !actual.frames.some((a) => a.time === f.time))
      .map((f) => f.time);
  const mismatches = frames
    .filter((f) => f.sha256 !== expected.get(f.time))
    .map((f) => ({
      time: f.time,
      expected: expected.get(f.time)!,
      actual: f.sha256,
    }));
  return {
    passed: dimensionMatch && !missingTimes.length && !mismatches.length,
    dimensionMatch,
    comparedFrames: frames.length,
    missingTimes,
    mismatches,
  };
}
