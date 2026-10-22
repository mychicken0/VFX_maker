import { useRef, useState } from "react";
import { KeyframeTrack } from "./KeyframeTrack.js";
import { DopeSheet } from "./DopeSheet.js";
import { NumberField } from "./controls.js";
import type { Layer, Project } from "../core/model.js";
export function Timeline({
  project: p,
  selected,
  select,
  time,
  setTime,
  playing,
  setPlaying,
  updateLayer,
  updateProject,
  focused,
  onFocus,
  onKeyframeView,
  selection,
  autoKey,
  setAutoKey,
  onTiming,
}: {
  focused: boolean;
  selection: string[];
  autoKey: boolean;
  setAutoKey: (value: boolean) => void;
  onTiming: () => void;
  onFocus: () => void;
  onKeyframeView: (open: boolean) => void;
  updateProject: (p: Project) => void;
  project: Project;
  selected?: string;
  select: (
    id: string,
    event?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  ) => void;
  time: number;
  setTime: (t: number) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  updateLayer: (id: string, patch: Record<string, unknown>) => void;
}) {
  const trackArea = useRef<HTMLDivElement>(null);
  const [showKeys, setShowKeys] = useState(false);
  const [allChannels, setAllChannels] = useState(false);
  const active = p.layers.find((l) => l.id === selected),
    range = p.editor.range;
  const drag = (
    e: React.PointerEvent<HTMLDivElement>,
    l: Layer,
    resize: boolean,
  ) => {
    if (e.button !== 0 || l.locked) return;
    e.stopPropagation();
    select(l.id);
    setPlaying(false);
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x = e.clientX,
      start = l.start,
      duration = l.duration,
      track = el.closest(".timeline-track") as HTMLDivElement;
    const width = track.getBoundingClientRect().width;
    let next = resize ? duration : start;
    const move = (e: PointerEvent) => {
      next =
        Math.round(
          Math.max(
            resize ? 0.02 : 0,
            Math.min(
              resize ? 10 : p.duration - 0.02,
              (resize ? duration : start) +
                ((e.clientX - x) / width) * p.duration,
            ),
          ) * 100,
        ) / 100;
      if (resize)
        (el.parentElement as HTMLElement).style.width =
          `${(Math.min(next, p.duration - start) / p.duration) * 100}%`;
      else el.style.left = `${(next / p.duration) * 100}%`;
    };
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      end();
    };
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", cancel);
      if (resize)
        (el.parentElement as HTMLElement).style.width =
          `${(Math.min(duration, p.duration - start) / p.duration) * 100}%`;
      else el.style.left = `${(start / p.duration) * 100}%`;
      if (!cancelled)
        updateLayer(l.id, resize ? { duration: next } : { start: next });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", cancel);
  };
  return (
    <section className="timeline">
      <div className="timeline-toolbar">
        <span className="panel-label">TIMELINE</span>
        <div className="playback">
          <button
            aria-label="Previous frame"
            title="Previous frame"
            onClick={() => {
              setPlaying(false);
              setTime(Math.max(0, time - 1 / p.fps));
            }}
          >
            Ⅰ‹
          </button>
          <button
            className="play-button"
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => setPlaying(!playing)}
          >
            {playing ? "Ⅱ" : "▶"}
          </button>
          <button
            aria-label="Next frame"
            title="Next frame"
            onClick={() => {
              setPlaying(false);
              setTime(Math.min(p.duration, time + 1 / p.fps));
            }}
          >
            ›Ⅰ
          </button>
          <span className="timecode">
            {time.toFixed(2)}
            <small> / {p.duration.toFixed(2)} s</small>
          </span>
        </div>
        <span className="timeline-help">
          Space to play <i>·</i> drag clips to retime
        </span>
      </div>
      <div className="timeline-tools">
        <button
          aria-pressed={showKeys}
          onClick={() => {
            setPlaying(false);
            onKeyframeView(!showKeys);
            setShowKeys((v) => !v);
          }}
        >
          Keyframes
        </button>
        <button
          aria-pressed={autoKey}
          title="Record position, rotation and scale edits at the playhead"
          onClick={() => {
            setPlaying(false);
            setAutoKey(!autoKey);
          }}
        >
          Auto key
        </button>
        {showKeys && (
          <button
            aria-pressed={allChannels}
            onClick={() => setAllChannels(!allChannels)}
          >
            {allChannels ? "Curve view" : "All channels"}
          </button>
        )}
        <button onClick={onTiming}>Timing tools</button>
        {showKeys && (
          <button onClick={onFocus} aria-pressed={focused}>
            {focused ? "Restore canvas" : "Focus timeline"}
          </button>
        )}
        <button
          aria-pressed={!!range}
          onClick={() =>
            updateProject({
              ...p,
              editor: {
                ...p.editor,
                range: range ? undefined : { start: 0, end: p.duration },
              },
            })
          }
        >
          Loop range
        </button>
        {range && (
          <>
            <NumberField
              label="Range start"
              value={range.start}
              min={0}
              max={range.end - 0.001}
              step={0.01}
              onChange={(start) =>
                updateProject({
                  ...p,
                  editor: { ...p.editor, range: { ...range, start } },
                })
              }
            />
            <NumberField
              label="Range end"
              value={range.end}
              min={range.start + 0.001}
              max={p.duration}
              step={0.01}
              onChange={(end) =>
                updateProject({
                  ...p,
                  editor: { ...p.editor, range: { ...range, end } },
                })
              }
            />
          </>
        )}
      </div>
      <div className="timeline-ruler">
        <span>LAYERS</span>
        <div>
          {range && (
            <span
              className="play-range"
              style={{
                left: `${(range.start / p.duration) * 100}%`,
                width: `${((range.end - range.start) / p.duration) * 100}%`,
              }}
            />
          )}
          {Array.from({ length: 7 }, (_, i) => (
            <small key={i} style={{ left: `${(i / 6) * 100}%` }}>
              {((i / 6) * p.duration).toFixed(1)}s
            </small>
          ))}
          <input
            aria-label="Playhead"
            type="range"
            min={0}
            max={p.duration}
            step={1 / p.fps}
            value={time}
            onChange={(e) => {
              setPlaying(false);
              setTime(Number(e.target.value));
            }}
          />
        </div>
      </div>
      <div className="timeline-tracks" ref={trackArea}>
        {showKeys && allChannels && (
          <DopeSheet
            project={p}
            ids={selection}
            time={time}
            update={updateProject}
          />
        )}
        {showKeys && !allChannels && active && (
          <KeyframeTrack project={p} layer={active} update={updateLayer} />
        )}
        {[...p.layers].reverse().map((l) => (
          <div
            key={l.id}
            className={`timeline-row ${selected === l.id ? "selected" : ""}`}
          >
            <button onClick={(e) => select(l.id, e)}>
              <span className={`type-dot ${l.type}`} />
              {l.name}
            </button>
            <div
              className="timeline-track"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  const b = e.currentTarget.getBoundingClientRect();
                  setPlaying(false);
                  setTime(((e.clientX - b.left) / b.width) * p.duration);
                }
              }}
            >
              <div
                className={`timeline-clip ${l.type} ${!l.visible ? "muted" : ""}`}
                style={{
                  left: `${(l.start / p.duration) * 100}%`,
                  width: `${(Math.max(0, Math.min(l.duration, p.duration - l.start)) / p.duration) * 100}%`,
                }}
                onPointerDown={(e) => drag(e, l, false)}
              >
                <span>
                  {l.repeat ? "↻ " : ""}
                  {l.name}
                </span>
                <div
                  className="clip-resize"
                  onPointerDown={(e) => drag(e, l, true)}
                />
              </div>
              <div
                className="playhead-line"
                style={{ left: `${(time / p.duration) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
