import { useEffect, useState } from "react";
import {
  curveChannels,
  getCurve,
  shiftKeys,
  deleteKeys,
  putKeyframe,
  type KeyRef,
} from "../core/editing.js";
import { readableError } from "../core/errors.js";
import type { Project, Curve } from "../core/model.js";
import { NumberField, Check } from "./controls.js";

const same = (a: KeyRef, b: KeyRef) =>
  a.layer === b.layer &&
  a.channel === b.channel &&
  Math.abs(a.time - b.time) < 1e-7;
interface CopiedKey {
  layer: string;
  channel: string;
  offset: number;
  value: number;
  ease: Curve[number]["ease"];
}
export function DopeSheet({
  project,
  ids,
  time,
  update,
}: {
  project: Project;
  ids: string[];
  time: number;
  update: (p: Project) => void;
}) {
  const [selected, setSelected] = useState<KeyRef[]>([]),
    [offset, setOffset] = useState(1 / project.fps),
    [dragOffset, setDragOffset] = useState(0),
    [error, setError] = useState(""),
    [snap, setSnap] = useState(true),
    [clipboard, setClipboard] = useState<CopiedKey[]>([]);
  useEffect(
    () =>
      setSelected((refs) =>
        refs.filter((ref) => {
          const l = project.layers.find((l) => l.id === ref.layer);
          return (
            l &&
            curveChannels(l).includes(ref.channel) &&
            getCurve(l, ref.channel).some(
              (k) => Math.abs(k.t - ref.time) < 1e-7,
            )
          );
        }),
      ),
    [project],
  );
  const act = (fn: () => Project) => {
    try {
      update(fn());
      setError("");
    } catch (e) {
      setError(readableError(e));
    }
  };
  const shift = (seconds: number, duplicate = false) => {
    try {
      const next = shiftKeys(project, selected, seconds, duplicate);
      update(next);
      setSelected(
        selected.map((r) => ({
          ...r,
          time:
            Math.round(
              (r.time +
                seconds /
                  project.layers.find((l) => l.id === r.layer)!.duration) *
                1e7,
            ) / 1e7,
        })),
      );
      setError("");
    } catch (e) {
      setError(readableError(e));
    }
  };
  const copy = () => {
    if (!selected.length) return;
    const keys = selected.map((r) => {
      const l = project.layers.find((l) => l.id === r.layer)!,
        k = getCurve(l, r.channel).find((k) => Math.abs(k.t - r.time) < 1e-7)!;
      return { ...r, ...k, seconds: l.start + k.t * l.duration };
    });
    const start = Math.min(...keys.map((k) => k.seconds));
    setClipboard(
      keys.map((k) => ({
        layer: k.layer,
        channel: k.channel,
        value: k.value,
        ease: k.ease,
        offset: k.seconds - start,
      })),
    );
    setError("");
  };
  const paste = () =>
    act(() => {
      let next = project;
      for (const k of clipboard) {
        const l = next.layers.find((l) => l.id === k.layer);
        if (!l) throw Error("The copied layer no longer exists");
        next = putKeyframe(
          next,
          k.layer,
          k.channel,
          (time + k.offset - l.start) / l.duration,
          k.value,
          k.ease,
        );
      }
      return next;
    });
  const drag = (event: React.PointerEvent<HTMLButtonElement>, ref: KeyRef) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (additive) {
      setSelected(
        selected.some((r) => same(r, ref))
          ? selected.filter((r) => !same(r, ref))
          : [...selected, ref],
      );
      return;
    }
    const refs = selected.some((r) => same(r, ref)) ? selected : [ref];
    setSelected(refs);
    const element = event.currentTarget,
      width = element.parentElement!.getBoundingClientRect().width,
      startX = event.clientX;
    element.setPointerCapture(event.pointerId);
    let seconds = 0;
    const minimum = Math.max(
      ...refs.map(
        (r) => -r.time * project.layers.find((l) => l.id === r.layer)!.duration,
      ),
    );
    const maximum = Math.min(
      ...refs.map(
        (r) =>
          (1 - r.time) * project.layers.find((l) => l.id === r.layer)!.duration,
      ),
    );
    const move = (e: PointerEvent) => {
      seconds = ((e.clientX - startX) / width) * project.duration;
      if (snap) seconds = Math.round(seconds * project.fps) / project.fps;
      seconds = Math.max(minimum, Math.min(maximum, seconds));
      setDragOffset(seconds);
    };
    const cleanup = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", end);
      element.removeEventListener("pointercancel", cancel);
      setDragOffset(0);
    };
    const end = () => {
      cleanup();
      if (Math.abs(seconds) > 1e-9) {
        try {
          update(shiftKeys(project, refs, seconds));
          setSelected(
            refs.map((r) => ({
              ...r,
              time:
                Math.round(
                  (r.time +
                    seconds /
                      project.layers.find((l) => l.id === r.layer)!.duration) *
                    1e7,
                ) / 1e7,
            })),
          );
          setError("");
        } catch (e) {
          setError(readableError(e));
        }
      }
    };
    const cancel = () => cleanup();
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", cancel);
  };
  return (
    <section
      className="dope-sheet"
      aria-label="Multi-channel keyframes"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest("input,select,textarea")) return;
        if (
          e.code === "Space" &&
          (e.target as HTMLElement).closest(".dope-key")
        )
          e.stopPropagation();
        if (
          (e.ctrlKey || e.metaKey) &&
          ["c", "v", "a"].includes(e.key.toLowerCase())
        ) {
          e.preventDefault();
          e.stopPropagation();
          if (e.key.toLowerCase() === "c") copy();
          else if (e.key.toLowerCase() === "v") paste();
          else
            setSelected(
              project.layers
                .filter((l) => ids.includes(l.id) && !l.locked)
                .flatMap((l) =>
                  curveChannels(l).flatMap((channel) =>
                    getCurve(l, channel).map((k) => ({
                      layer: l.id,
                      channel,
                      time: k.t,
                    })),
                  ),
                ),
            );
        }
        if (["Delete", "Backspace"].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          act(() => deleteKeys(project, selected));
        }
        if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          shift(
            ((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 1)) /
              project.fps,
          );
        }
      }}
    >
      <div className="dope-toolbar">
        <small>
          {selected.length} keys selected · Shift-click to select more
        </small>
        <Check label="Snap keys to frames" value={snap} onChange={setSnap} />
        <NumberField
          label="Key offset seconds"
          value={offset}
          min={-10}
          max={10}
          step={0.01}
          onChange={setOffset}
        />
        <button disabled={!selected.length} onClick={() => shift(offset)}>
          Move keys
        </button>
        <button disabled={!selected.length} onClick={() => shift(offset, true)}>
          Duplicate keys
        </button>
        <button disabled={!selected.length} onClick={copy}>
          Copy keys
        </button>
        <button disabled={!clipboard.length} onClick={paste}>
          Paste at playhead
        </button>
        <button
          disabled={!selected.length}
          onClick={() => act(() => deleteKeys(project, selected))}
        >
          Delete keys
        </button>
      </div>
      {project.layers
        .filter((l) => ids.includes(l.id))
        .map((l) => (
          <details key={l.id} open className="dope-layer">
            <summary>
              {l.name}
              {l.locked && " · locked"}
            </summary>
            {curveChannels(l).map((channel) => (
              <div className="dope-row" key={channel}>
                <span>{channel.replace("motion.", "")}</span>
                <div className="dope-track">
                  {getCurve(l, channel).map((k) => {
                    const ref = { layer: l.id, channel, time: k.t },
                      active = selected.some((r) => same(r, ref));
                    return (
                      <button
                        key={k.t}
                        aria-label={`${l.name} ${channel} key ${k.t}`}
                        aria-pressed={active}
                        disabled={l.locked}
                        className={`dope-key ${active ? "selected" : ""}`}
                        style={{
                          left: `${((l.start + k.t * l.duration + (active ? dragOffset : 0)) / project.duration) * 100}%`,
                        }}
                        onPointerDown={(e) => drag(e, ref)}
                        onClick={(e) => {
                          if (e.detail === 0)
                            setSelected(
                              e.shiftKey
                                ? [
                                    ...selected.filter((r) => !same(r, ref)),
                                    ref,
                                  ]
                                : [ref],
                            );
                        }}
                        title={`${k.value} · ${(l.start + k.t * l.duration).toFixed(3)}s`}
                      >
                        ◆
                      </button>
                    );
                  })}
                  <div
                    className="playhead-line"
                    style={{ left: `${(time / project.duration) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </details>
        ))}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
