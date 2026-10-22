import { useRef } from "react";
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
}: {
  project: Project;
  selected?: string;
  select: (id: string) => void;
  time: number;
  setTime: (t: number) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  updateLayer: (id: string, patch: Record<string, unknown>) => void;
}) {
  const trackArea = useRef<HTMLDivElement>(null);
  const drag = (
    e: React.PointerEvent<HTMLDivElement>,
    l: Layer,
    resize: boolean,
  ) => {
    if (l.locked) return;
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
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      if (resize)
        (el.parentElement as HTMLElement).style.width =
          `${(Math.min(duration, p.duration - start) / p.duration) * 100}%`;
      else el.style.left = `${(start / p.duration) * 100}%`;
      updateLayer(l.id, resize ? { duration: next } : { start: next });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
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
      <div className="timeline-ruler">
        <span>LAYERS</span>
        <div>
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
        {[...p.layers].reverse().map((l) => (
          <div
            key={l.id}
            className={`timeline-row ${selected === l.id ? "selected" : ""}`}
          >
            <button onClick={() => select(l.id)}>
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
