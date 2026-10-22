import { useEffect, useRef, useState } from "react";
import type { Project } from "../core/model.js";
import { VfxRenderer } from "../render/pixi.js";
import { readableError } from "../core/errors.js";
export function OnionSkin({
  project,
  time,
  onError,
}: {
  project: Project;
  time: number;
  onError: (e: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    renderers = useRef<VfxRenderer[]>([]),
    clock = useRef(time),
    [ready, setReady] = useState(false);
  clock.current = time;
  const render = (value: number) =>
    renderers.current.forEach((r, i) => {
      const t = value + (i ? 1 : -1) / project.fps,
        outside = t < 0 || t >= project.duration;
      r.canvas.style.visibility =
        outside && !project.loop ? "hidden" : "visible";
      r.render(
        project.loop
          ? ((t % project.duration) + project.duration) % project.duration
          : Math.max(0, Math.min(project.duration, t)),
      );
    });
  useEffect(() => {
    let alive = true;
    void Promise.allSettled([VfxRenderer.create(), VfxRenderer.create()])
      .then((results) => {
        const list = results.flatMap((r) =>
          r.status === "fulfilled" ? [r.value] : [],
        );
        const failure = results.find((r) => r.status === "rejected");
        if (failure?.status === "rejected") {
          list.forEach((r) => r.destroy());
          throw failure.reason;
        }
        if (!alive) {
          list.forEach((r) => r.destroy());
          return;
        }
        renderers.current = list;
        list.forEach((r, i) => {
          r.canvas.dataset.onion = i ? "next" : "previous";
          r.canvas.className = i ? "onion-next" : "onion-previous";
          host.current?.append(r.canvas);
        });
        setReady(true);
      })
      .catch((e) => onError(readableError(e)));
    return () => {
      alive = false;
      renderers.current.forEach((r) => r.destroy());
      renderers.current = [];
    };
  }, []);
  useEffect(() => {
    if (ready)
      void Promise.all(renderers.current.map((r) => r.setProject(project)))
        .then(() => render(clock.current))
        .catch((e) => onError(readableError(e)));
  }, [ready, project]);
  useEffect(() => {
    if (ready)
      try {
        render(time);
      } catch (e) {
        onError(readableError(e));
      }
  }, [ready, time]);
  return (
    <div ref={host} className="onion-skin" aria-label="Onion skin frames" />
  );
}
