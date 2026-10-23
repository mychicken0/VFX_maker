import {
  parseProject,
  gradientSchema,
  colorSchema,
  type Gradient,
  type Project,
} from "./model.js";

/** Set actual gradient/tint values, including achromatic smoke. */
export function setProjectGradient(
  project: Project,
  colors: Gradient | string,
  includeLocked = false,
  ids?: string[],
): Project {
  const gradient =
    typeof colors === "string"
      ? [{ t: 0, color: colorSchema.parse(colors) }]
      : gradientSchema.parse(colors);
  if (ids?.some((id) => !project.layers.some((l) => l.id === id)))
    throw Error("Unknown layer in color selection");
  const chosen = new Set(
    project.layers
      .filter(
        (l) => (includeLocked || !l.locked) && (!ids || ids.includes(l.id)),
      )
      .map((l) => l.id),
  );
  const isHue = (b: Project["controls"][number]["bindings"][number]) =>
    b.target === "colors.hue" && chosen.has(b.layer);
  return parseProject({
    ...project,
    layers: project.layers.map((l) =>
      chosen.has(l.id) ? { ...l, colors: structuredClone(gradient) } : l,
    ),
    controls: project.controls.map((c) => {
      if (!c.bindings.some(isHue)) return c;
      // Keep ordinary Hue controls usable, without shifting the requested color.
      if (
        c.bindings.every((b) => isHue(b) && b.offset === 0) &&
        c.min <= 0 &&
        c.max >= 0
      )
        return { ...c, value: 0 };
      // Mixed controls must not change unselected or locked layers.
      return { ...c, bindings: c.bindings.filter((b) => !isHue(b)) };
    }),
  });
}
/** Scale the complete composition uniformly, or crop/expand only its canvas. */
export function resizeProject(
  project: Project,
  width: number,
  height: number,
  mode: "scale" | "canvas" = "scale",
): Project {
  if (!["scale", "canvas"].includes(mode))
    throw new Error("Resize mode must be scale or canvas");
  const sx = width / project.canvas.width,
    sy = height / project.canvas.height,
    factor = Math.min(sx, sy);
  const dx = (width - project.canvas.width * factor) / 2,
    dy = (height - project.canvas.height * factor) / 2;
  return parseProject({
    ...project,
    canvas: { ...project.canvas, width, height },
    editor:
      mode === "scale" && project.editor.reference
        ? {
            ...project.editor,
            reference: {
              ...project.editor.reference,
              position: {
                x: project.editor.reference.position.x * factor + dx,
                y: project.editor.reference.position.y * factor + dy,
              },
              scale: project.editor.reference.scale * factor,
            },
          }
        : project.editor,
    layers:
      mode === "canvas"
        ? project.layers
        : project.layers.map((l) => ({
            ...l,
            position: {
              x: l.position.x * factor + dx,
              y: l.position.y * factor + dy,
            },
            scale: l.scale * factor,
            glow: { ...l.glow, blur: l.glow.blur * factor },
            motion: {
              ...l.motion,
              x: l.motion.x.map((k) => ({ ...k, value: k.value * factor })),
              y: l.motion.y.map((k) => ({ ...k, value: k.value * factor })),
            },
          })),
  });
}
export function uniqueLayerName(name: string, existing: string[]): string {
  name = name.slice(0, 100);
  if (!existing.includes(name)) return name;
  const base = name.replace(/ \d+$/, "");
  let n = 2;
  const candidate = () => `${base.slice(0, 100 - String(n).length - 1)} ${n}`;
  while (existing.includes(candidate())) n++;
  return candidate();
}

/** Keep flipbook grids and all asset references intact during replacement. */
export function replaceAssetPng(
  project: Project,
  id: string,
  png: Uint8Array,
  width: number,
  height: number,
): Project {
  if (!project.assets.some((a) => a.id === id))
    throw new Error(`Unknown asset ${id}`);
  let binary = "";
  for (let i = 0; i < png.length; i += 8192)
    binary += String.fromCharCode(...png.subarray(i, i + 8192));
  return parseProject({
    ...project,
    assets: project.assets.map((a) =>
      a.id === id
        ? { ...a, width, height, data: "data:image/png;base64," + btoa(binary) }
        : a,
    ),
  });
}

/** Rotate RGB hue while retaining each color's brightness and saturation. */
export function shiftColorHue(color: string, degrees: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(color) || !Number.isFinite(degrees))
    throw new Error("Use a hex RGB color and finite hue angle");
  if (degrees % 360 === 0) return color;
  const [r, g, b] = [1, 3, 5].map(
      (i) => parseInt(color.slice(i, i + 2), 16) / 255,
    ),
    hi = Math.max(r, g, b),
    lo = Math.min(r, g, b),
    delta = hi - lo;
  if (!delta) return color;
  let h =
    hi === r
      ? (g - b) / delta
      : hi === g
        ? 2 + (b - r) / delta
        : 4 + (r - g) / delta;
  h = (((h + degrees / 60) % 6) + 6) % 6;
  const x = delta * (1 - Math.abs((h % 2) - 1));
  const rgb =
    h < 1
      ? [delta, x, 0]
      : h < 2
        ? [x, delta, 0]
        : h < 3
          ? [0, delta, x]
          : h < 4
            ? [0, x, delta]
            : h < 5
              ? [x, 0, delta]
              : [delta, 0, x];
  return (
    "#" +
    rgb
      .map((v) =>
        Math.round((v + lo) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
export function recolorProject(
  project: Project,
  degrees: number,
  includeLocked = false,
  ids?: string[],
): Project {
  if (!Number.isFinite(degrees) || degrees < -360 || degrees > 360)
    throw new Error("Hue angle must be in -360..360 degrees");
  if (ids?.some((id) => !project.layers.some((l) => l.id === id)))
    throw new Error("Unknown layer in recolor selection");
  return parseProject({
    ...project,
    layers: project.layers.map((l) =>
      (l.locked && !includeLocked) || (ids && !ids.includes(l.id))
        ? l
        : {
            ...l,
            colors: l.colors.map((s) => ({
              ...s,
              color: shiftColorHue(s.color, degrees),
            })),
          },
    ),
  });
}
