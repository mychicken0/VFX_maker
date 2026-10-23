import { useEffect, useState } from "react";
import type { Curve, Gradient } from "../core/model.js";
import { clamp, evaluate } from "../core/math.js";
export function NumberField({
  label,
  value,
  onChange,
  min = -4096,
  max = 4096,
  step = 1,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(4))));
  useEffect(() => setDraft(String(Number(value.toFixed(4)))), [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <div className="number-wrap">
        <input
          aria-label={label}
          type="number"
          value={draft}
          min={min}
          max={max}
          step={step}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          onBlur={() => {
            const n = Number(draft);
            setDraft(String(Number(value.toFixed(4))));
            if (draft !== "" && Number.isFinite(n))
              onChange(
                Math.max(min, Math.min(max, step === 1 ? Math.round(n) : n)),
              );
            else setDraft(String(value));
          }}
        />
        {unit && <small>{unit}</small>}
      </div>
    </label>
  );
}
export function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </label>
  );
}
export function Check({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="check">
      <span>{label}</span>
      <input
        aria-label={label}
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
export function CurveEditor({
  label,
  keys,
  onChange,
  max = 32,
  min = 0,
  signed = false,
}: {
  label: string;
  keys: Curve;
  onChange: (k: Curve) => void;
  max?: number;
  min?: number;
  signed?: boolean;
}) {
  const [expanded, setExpanded] = useState(false),
    [selected, setSelected] = useState<number | null>(null),
    [draft, setDraft] = useState<Curve | null>(null);
  const shown = draft ?? keys;
  useEffect(() => {
    setSelected(null);
    setDraft(null);
  }, [label]);
  const maxY = Math.max(1, ...keys.map((k) => k.value)) * 1.1;
  const minY = Math.min(0, ...keys.map((k) => k.value)) * 1.1;
  const y = (v: number) => 56 - ((v - minY) / (maxY - minY)) * 48;
  const poly = Array.from(
    { length: 101 },
    (_, i) => `${i * 2},${y(evaluate(shown, i / 100))}`,
  ).join(" ");
  const update = (i: number, patch: Partial<Curve[number]>) => {
    const next = keys
      .map((k, n) => (n === i ? { ...k, ...patch } : k))
      .sort((a, b) => a.t - b.t);
    if (next.every((k, n) => n === 0 || k.t > next[n - 1].t)) onChange(next);
  };
  const drag = (event: React.PointerEvent<SVGCircleElement>, index: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelected(index);
    setExpanded(true);
    const el = event.currentTarget,
      box = el.closest("svg")!.getBoundingClientRect(),
      original = structuredClone(keys),
      startX = event.clientX,
      startY = event.clientY;
    let next = original;
    el.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const t = clamp(
        original[index].t + (e.clientX - startX) / box.width,
        index ? original[index - 1].t + 0.00001 : 0,
        index + 1 < original.length ? original[index + 1].t - 0.00001 : 1,
      );
      const value = clamp(
        original[index].value -
          ((((e.clientY - startY) / box.height) * 64) / 48) * (maxY - minY),
        signed ? -4096 : min,
        signed ? 4096 : max,
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
      if (JSON.stringify(next) !== JSON.stringify(original)) onChange(next);
    };
    const cancel = () => cleanup();
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", cancel);
  };
  return (
    <div className="curve-control">
      <button className="section-toggle" onClick={() => setExpanded(!expanded)}>
        <span>{label}</span>
        <small>
          {keys.length} keys {expanded ? "−" : "+"}
        </small>
      </button>
      <svg
        role="img"
        aria-label={`${label} curve`}
        viewBox="0 0 200 64"
        preserveAspectRatio="none"
        className="curve-graph"
        onDoubleClick={(e) => {
          if (keys.length >= 32 || (e.target as Element).closest("circle"))
            return;
          const b = e.currentTarget.getBoundingClientRect(),
            t = Math.round(((e.clientX - b.left) / b.width) * 100) / 100;
          if (t <= 0 || t >= 1 || keys.some((k) => Math.abs(k.t - t) < 0.01))
            return;
          const value = clamp(
            minY +
              ((56 - ((e.clientY - b.top) / b.height) * 64) / 48) *
                (maxY - minY),
            signed ? -4096 : min,
            signed ? 4096 : max,
          );
          onChange(
            [...keys, { t, value, ease: "linear" as const }].sort(
              (a, b) => a.t - b.t,
            ),
          );
          setExpanded(true);
        }}
      >
        <path
          d="M0 16H200M0 36H200M0 56H200M50 0V64M100 0V64M150 0V64"
          stroke="#30313e"
          strokeWidth="0.6"
        />
        <polygon points={`0,64 ${poly} 200,64`} fill="#9e83ff12" />
        <polyline
          points={poly}
          fill="none"
          stroke="#ad94ff"
          strokeWidth="1.5"
        />
        {shown.map((k, i) => (
          <circle
            key={i}
            aria-label={`${label} curve key ${i + 1}`}
            cx={k.t * 200}
            cy={y(k.value)}
            r="5"
            fill={selected === i ? "#ffdc91" : "#e0d5ff"}
            onPointerDown={(e) => drag(e, i)}
          />
        ))}
      </svg>
      {expanded && (
        <div className="key-list">
          {keys.map((k, i) => (
            <div className="key-row" key={i}>
              <NumberField
                label={`${label} key ${i + 1} time`}
                value={k.t}
                min={0}
                max={1}
                step={0.01}
                onChange={(t) => update(i, { t })}
              />
              <NumberField
                label={`${label} key ${i + 1} value`}
                value={k.value}
                min={signed ? -4096 : min}
                max={signed ? 4096 : max}
                step={0.1}
                onChange={(value) => update(i, { value })}
              />
              <select
                aria-label={`${label} key ${i + 1} easing`}
                value={k.ease}
                onChange={(e) =>
                  update(i, { ease: e.target.value as Curve[number]["ease"] })
                }
              >
                <option>linear</option>
                <option>smooth</option>
                <option>hold</option>
              </select>
              <button
                title="Delete key"
                disabled={keys.length <= 1}
                onClick={() => onChange(keys.filter((_, n) => n !== i))}
              >
                ×
              </button>
            </div>
          ))}
          <p className="hint">
            Drag a point to change time and value. Double-click to add. Time
            runs from 0 to 1 over this layer's life.
          </p>
        </div>
      )}
    </div>
  );
}
export function GradientEditor({
  stops,
  onChange,
}: {
  stops: Gradient;
  onChange: (g: Gradient) => void;
}) {
  return (
    <div className="gradient-control">
      <div className="section-toggle">
        <span>Color over life</span>
        <button
          title="Add color stop"
          disabled={stops.length >= 16}
          onClick={() => {
            const gaps = stops.slice(1).map((s, i) => ({
              gap: s.t - stops[i].t,
              t: (s.t + stops[i].t) / 2,
            }));
            const t = gaps.length
              ? gaps.sort((a, b) => b.gap - a.gap)[0].t
              : stops[0].t < 1
                ? 1
                : 0;
            onChange(
              [...stops, { t, color: stops.at(-1)!.color }].sort(
                (a, b) => a.t - b.t,
              ),
            );
          }}
        >
          +
        </button>
      </div>
      <div
        className="gradient-strip"
        style={{
          background: `linear-gradient(90deg, ${stops.map((s) => `${s.color} ${s.t * 100}%`).join(",")})`,
        }}
      />
      <div className="color-stops">
        {stops.map((s, i) => (
          <div key={i}>
            <input
              aria-label={`Color stop ${i + 1}`}
              type="color"
              value={s.color}
              onChange={(e) =>
                onChange(
                  stops.map((c, n) =>
                    n === i ? { ...c, color: e.target.value } : c,
                  ),
                )
              }
            />
            <NumberField
              label={`Stop ${i + 1} time`}
              value={s.t}
              min={0}
              max={1}
              step={0.01}
              onChange={(t) => {
                const next = stops
                  .map((c, n) => (n === i ? { ...c, t } : c))
                  .sort((a, b) => a.t - b.t);
                if (next.every((v, n) => n === 0 || v.t > next[n - 1].t))
                  onChange(next);
              }}
            />
            <button
              disabled={stops.length <= 1}
              title="Remove color"
              onClick={() => onChange(stops.filter((_, n) => n !== i))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
