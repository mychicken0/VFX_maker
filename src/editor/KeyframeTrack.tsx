import { useEffect, useRef, useState } from "react";
import { curveChannels, getCurve, curvePatch } from "../core/editing.js";
import { clamp, evaluate } from "../core/math.js";
import type { Curve, Layer, Project } from "../core/model.js";
import { NumberField, Select, Check } from "./controls.js";
export function KeyframeTrack({
  project,
  layer,
  update,
}: {
  project: Project;
  layer: Layer;
  update: (id: string, patch: Record<string, unknown>) => void;
}) {
  const [channel, setChannel] = useState("motion.x"),
    [selected, setSelected] = useState<number | null>(null),
    [draft, setDraft] = useState<Curve | null>(null),
    [snap, setSnap] = useState(true),
    [graphWidth, setGraphWidth] = useState(1000);
  const graph = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setGraphWidth(Math.max(1, entry.contentRect.width)),
    );
    if (graph.current) observer.observe(graph.current);
    return () => observer.disconnect();
  }, []);
  const channels = curveChannels(layer),
    active = channels.includes(channel) ? channel : "motion.x",
    source = getCurve(layer, active),
    keys = draft ?? source;
  useEffect(() => {
    setSelected(null);
    setDraft(null);
  }, [layer.id, active]);
  const positive = [
      "opacity",
      "draw",
      "size",
      "width",
      "height",
      "radius",
      "motion.scale",
    ].includes(active),
    minimum = active === "motion.scale" ? 0.01 : positive ? 0 : -4096,
    maximum = ["opacity", "draw"].includes(active)
      ? 1
      : active === "motion.scale"
        ? 16
        : 4096;
  const low = Math.max(
      minimum,
      Math.min(...source.map((k) => k.value)) -
        Math.max(
          0.1,
          (Math.max(...source.map((k) => k.value)) -
            Math.min(...source.map((k) => k.value))) *
            0.15,
        ),
    ),
    high = Math.min(
      maximum,
      Math.max(...source.map((k) => k.value)) +
        Math.max(
          1,
          (Math.max(...source.map((k) => k.value)) -
            Math.min(...source.map((k) => k.value))) *
            0.15,
        ),
    );
  const y = (value: number) =>
    66 - ((value - low) / Math.max(0.0001, high - low)) * 60;
  const commit = (next: Curve) => update(layer.id, curvePatch(active, next));
  const atTime = (time: number, index: number, source = keys) =>
    clamp(
      time,
      index ? source[index - 1].t + 0.00001 : 0,
      index + 1 < source.length ? source[index + 1].t - 0.00001 : 1,
    );
  const drag = (event: React.PointerEvent<SVGCircleElement>, index: number) => {
    if (layer.locked || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelected(index);
    const el = event.currentTarget,
      rect = el.closest("svg")!.getBoundingClientRect(),
      original = structuredClone(keys),
      startX = event.clientX,
      startY = event.clientY;
    let next = original;
    el.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      let seconds =
        layer.start +
        original[index].t * layer.duration +
        ((e.clientX - startX) / rect.width) * project.duration;
      if (snap) seconds = Math.round(seconds * project.fps) / project.fps;
      const t = atTime(
          (seconds - layer.start) / layer.duration,
          index,
          original,
        ),
        value = clamp(
          original[index].value -
            (((e.clientY - startY) / rect.height) * (high - low) * 72) / 60,
          minimum,
          maximum,
        );
      next = original.map((k, i) =>
        i === index ? { ...k, t, value: Math.round(value * 10000) / 10000 } : k,
      );
      setDraft(next);
    };
    const cleanup = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", cancel);
      setDraft(null);
    };
    const end = () => {
      cleanup();
      commit(next);
    };
    const cancel = () => cleanup();
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", cancel);
  };
  const index = selected !== null && selected < keys.length ? selected : null,
    key = index === null ? null : keys[index];
  const updateSelected = (patch: Partial<Curve[number]>) => {
    if (index === null) return;
    commit(keys.map((k, i) => (i === index ? { ...k, ...patch } : k)));
  };
  return (
    <div className="keyframe-editor">
      <div className="keyframe-heading">
        <Select
          label="Keyframe channel"
          value={active}
          options={channels}
          onChange={setChannel}
        />
        <Check
          label="Snap keyframes to frames"
          value={snap}
          onChange={setSnap}
        />
        <small>{layer.name}</small>
      </div>
      <svg
        ref={graph}
        className="keyframe-track"
        role="img"
        aria-label="Timeline keyframe graph"
        viewBox={`0 0 ${graphWidth} 72`}
        preserveAspectRatio="none"
        onDoubleClick={(e) => {
          if (layer.locked || (e.target as Element).closest("[data-key]"))
            return;
          const rect = e.currentTarget.getBoundingClientRect();
          let seconds =
            ((e.clientX - rect.left) / rect.width) * project.duration;
          if (snap) seconds = Math.round(seconds * project.fps) / project.fps;
          const t = clamp((seconds - layer.start) / layer.duration),
            value = clamp(
              low +
                ((66 - ((e.clientY - rect.top) / rect.height) * 72) / 60) *
                  (high - low),
              minimum,
              maximum,
            ),
            existing = keys.findIndex((k) => Math.abs(k.t - t) < 0.00001);
          if (existing >= 0) {
            setSelected(existing);
            return;
          }
          if (keys.length >= 32) return;
          const next = [...keys, { t, value, ease: "linear" as const }].sort(
            (a, b) => a.t - b.t,
          );
          commit(next);
          setSelected(next.findIndex((k) => k.t === t));
        }}
      >
        <path
          d={Array.from({ length: 100 }, (_, i) => {
            const global = (i / 99) * project.duration,
              u = (global - layer.start) / layer.duration;
            return `${i ? "L" : "M"}${(i / 99) * graphWidth} ${y(evaluate(keys, u))}`;
          }).join(" ")}
          stroke="#aa8fd8"
          fill="none"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
        {keys.map((k, i) => (
          <circle
            key={i}
            data-key={i}
            aria-label={`Timeline key ${i + 1}`}
            cx={
              ((layer.start + k.t * layer.duration) / project.duration) *
              graphWidth
            }
            cy={y(k.value)}
            r="5"
            fill={index === i ? "#f3dca0" : "#c1a4ed"}
            stroke="#32243e"
            vectorEffect="non-scaling-stroke"
            onPointerDown={(e) => drag(e, i)}
          />
        ))}
      </svg>
      <p className="hint">
        Double-click to add. Drag keys to retime/change values.{" "}
        {layer.locked ? "Unlock this layer to edit." : ""}
      </p>
      {key && index !== null && (
        <fieldset disabled={layer.locked} className="keyframe-values">
          <NumberField
            label="Timeline key time"
            value={layer.start + key.t * layer.duration}
            min={layer.start}
            max={layer.start + layer.duration}
            step={0.01}
            unit="s"
            onChange={(seconds) =>
              updateSelected({
                t: atTime((seconds - layer.start) / layer.duration, index),
              })
            }
          />
          <NumberField
            label="Timeline key value"
            value={key.value}
            min={minimum}
            max={maximum}
            step={0.01}
            onChange={(value) => updateSelected({ value })}
          />
          <Select
            label="Timeline key easing"
            value={key.ease}
            options={["linear", "smooth", "hold"]}
            onChange={(ease) =>
              updateSelected({ ease: ease as Curve[number]["ease"] })
            }
          />
          <button
            disabled={keys.length === 1}
            onClick={() => {
              commit(keys.filter((_, i) => i !== index));
              setSelected(null);
            }}
          >
            Delete key
          </button>
        </fieldset>
      )}
    </div>
  );
}
