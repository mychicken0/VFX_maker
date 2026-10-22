import { useEffect, useState } from "react";
import { z } from "zod";
const schema = z.object({
  left: z.number().min(180).max(380),
  right: z.number().min(240).max(420),
  timeline: z.number().min(90).max(400),
  leftOpen: z.boolean(),
  rightOpen: z.boolean(),
  timelineOpen: z.boolean(),
});
const defaults = {
  left: 246,
  right: 292,
  timeline: 230,
  leftOpen: true,
  rightOpen: true,
  timelineOpen: true,
};
export function useStudioLayout() {
  const [size, setSize] = useState({ width: innerWidth, height: innerHeight });
  const [layout, setLayout] = useState(() => {
    try {
      return schema.parse(
        JSON.parse(localStorage.getItem("vfx-maker.layout") ?? "null"),
      );
    } catch {
      return defaults;
    }
  });
  const [drawer, setDrawer] = useState<"left" | "right" | null>(null);
  const compact = size.width < 1000;
  useEffect(() => {
    const onResize = () => setSize({ width: innerWidth, height: innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("vfx-maker.layout", JSON.stringify(layout));
    } catch {}
  }, [layout]);
  const leftVisible = compact ? drawer === "left" : layout.leftOpen,
    rightVisible = compact ? drawer === "right" : layout.rightOpen;
  const factor = Math.min(
    1,
    (size.width - 332) /
      ((leftVisible ? layout.left : 0) + (rightVisible ? layout.right : 0) ||
        1),
  );
  const left = Math.max(180, Math.floor(layout.left * factor)),
    right = Math.max(240, Math.floor(layout.right * factor));
  const timeline = Math.max(90, Math.min(layout.timeline, size.height - 300));
  const toggle = (panel: "left" | "right" | "timeline") => {
    if (compact && panel !== "timeline")
      setDrawer((d) => (d === panel ? null : panel));
    else {
      const key = `${panel}Open` as const;
      setLayout((l) => ({ ...l, [key]: !l[key] }));
    }
  };
  const resize = (panel: "left" | "right" | "timeline", delta: number) =>
    setLayout((l) => ({
      ...l,
      [panel]: Math.max(
        panel === "left" ? 180 : panel === "right" ? 240 : 90,
        Math.min(
          panel === "left" ? 380 : panel === "right" ? 420 : 400,
          l[panel] + delta,
        ),
      ),
    }));
  const drag = (
    event: React.PointerEvent<HTMLElement>,
    panel: "left" | "right" | "timeline",
  ) => {
    event.preventDefault();
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    let prior = panel === "timeline" ? event.clientY : event.clientX;
    const move = (e: PointerEvent) => {
      const next = panel === "timeline" ? e.clientY : e.clientX;
      resize(panel, (next - prior) * (panel === "left" ? 1 : -1));
      prior = next;
    };
    const end = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", end);
      element.removeEventListener("pointercancel", end);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", end);
  };
  return {
    layout,
    compact,
    drawer,
    setDrawer,
    leftVisible,
    rightVisible,
    toggle,
    resize,
    drag,
    reset: () => {
      setLayout(defaults);
      setDrawer(null);
    },
    style: {
      "--left-size": `${leftVisible && !compact ? left : 0}px`,
      "--right-size": `${rightVisible && !compact ? right : 0}px`,
      "--left-handle": leftVisible && !compact ? "6px" : "0px",
      "--right-handle": rightVisible && !compact ? "6px" : "0px",
      "--timeline-size": `${layout.timelineOpen ? timeline : 43}px`,
    } as React.CSSProperties,
  };
}
