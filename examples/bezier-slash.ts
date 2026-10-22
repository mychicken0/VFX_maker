import {
  defineEffect,
  path,
  particles,
  curve,
  colors,
  defaultHandles,
} from "vfx-maker";

const points = [
  { x: -42, y: 20 },
  { x: -8, y: -30 },
  { x: 42, y: -12 },
];
export default defineEffect({
  name: "Crimson crescent",
  duration: 0.9,
  fps: 30,
  seed: 42,
  groups: [{ id: "attack", name: "Attack", ids: ["slash", "embers"] }],
  editor: { range: { start: 0.05, end: 0.65 } },
  layers: [
    path({
      id: "slash",
      name: "Curved blade",
      position: { x: 64, y: 64 },
      points,
      handles: defaultHandles(points),
      duration: 0.65,
      width: curve(9, 6, 0),
      draw: curve(0, 1, 1),
      opacity: curve(1, 1, 0),
      colors: colors("#fff4dc", "#ff274b", "#940d40"),
      glow: { strength: 1.4, blur: 3 },
      mask: { shape: "ellipse", width: 116, height: 100 },
      motion: { rotation: curve(-10, 8), x: curve(-2, 4) },
    }),
    particles({
      id: "embers",
      name: "Blade embers",
      position: { x: 64, y: 64 },
      points,
      mode: "path",
      count: 36,
      duration: 0.7,
      speed: [8, 28],
      size: curve(2, 1, 0),
      colors: colors("#ffc98d", "#ff2a58"),
      opacity: curve(1, 0),
    }),
  ],
});
