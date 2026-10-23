import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { zipSync } from "fflate";
import { VERSION, parseProject, type Project } from "../core/model.js";
import type { EffectRenderer } from "./types.js";
import {
  createPalette,
  processPixels,
  encodePng,
  type Bitmap,
} from "../core/pixels.js";

import { exportPlan, type ExportOptions } from "../core/export-options.js";
export {
  exportOptionsSchema,
  type ExportOptions,
} from "../core/export-options.js";
export type ExportFiles = Record<string, Uint8Array>;
export type Progress = (completed: number, total: number) => void;
const text = (s: string) => new TextEncoder().encode(s);
export function schedule(duration: number, fps: number) {
  const count = Math.ceil(duration * fps - 1e-9);
  return Array.from({ length: count }, (_, i) => ({
    time: i / fps,
    duration: Math.min(1 / fps, duration - i / fps),
  }));
}
export async function preview(
  renderer: EffectRenderer,
  project: Project,
  time: number,
): Promise<Uint8Array> {
  if (!Number.isFinite(time) || time < 0 || time > project.duration)
    throw new Error("Preview time is outside the effect duration");
  renderer.render(time);
  // Encode the same straight RGBA as export; a Canvas2D round-trip changes
  // translucent RGB by a few units through an extra premultiplication.
  return encodePng({
    width: project.canvas.width,
    height: project.canvas.height,
    rgba: renderer.pixels(),
  });
}
// Bound palette sampling independently from total frame count.
function sampleFrames(frames: Bitmap[]) {
  const total = frames.reduce((n, frame) => n + frame.width * frame.height, 0);
  const step = Math.max(1, Math.ceil(total / 65536));
  const bytes = new Uint8ClampedArray(Math.ceil(total / step) * 4);
  let index = 0,
    offset = 0;
  for (const frame of frames)
    for (let i = 0; i < frame.rgba.length; i += 4, index++)
      if (index % step === 0) {
        bytes.set(frame.rgba.subarray(i, i + 4), offset);
        offset += 4;
      }
  return bytes.subarray(0, offset);
}
function mattePixels(frame: Bitmap, matte: string): Bitmap {
  const rgb = [1, 3, 5].map((i) => parseInt(matte.slice(i, i + 2), 16));
  const rgba = new Uint8ClampedArray(frame.rgba);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    for (let c = 0; c < 3; c++)
      rgba[i + c] = Math.round(rgba[i + c] * a + rgb[c] * (1 - a));
    rgba[i + 3] = 255;
  }
  return { ...frame, rgba };
}
function drawPadded(
  atlas: Bitmap,
  frame: Bitmap,
  x: number,
  y: number,
  padding: number,
  extrude: boolean,
) {
  for (let dy = -padding; dy < frame.height + padding; dy++)
    for (let dx = -padding; dx < frame.width + padding; dx++) {
      if (
        !extrude &&
        (dx < 0 || dy < 0 || dx >= frame.width || dy >= frame.height)
      )
        continue;
      const sx = Math.max(0, Math.min(frame.width - 1, dx)),
        sy = Math.max(0, Math.min(frame.height - 1, dy));
      const from = (sy * frame.width + sx) * 4,
        to = ((y + dy) * atlas.width + x + dx) * 4;
      atlas.rgba.set(frame.rgba.subarray(from, from + 4), to);
    }
}
export async function exportEffect(
  renderer: EffectRenderer,
  value: Project,
  input: ExportOptions = {},
  progress?: Progress,
  signal?: AbortSignal,
): Promise<ExportFiles> {
  const project = parseProject(value),
    plan = exportPlan(project, input);
  if (plan.options.view === "stage" && renderer.view !== "stage") {
    const { StageRenderer } = await import("./stage.js");
    const staged = await StageRenderer.create();
    try {
      await staged.setProject(project);
      return await exportEffect(staged, project, input, progress, signal);
    } finally {
      staged.destroy();
    }
  }
  const { options, pixels, fps, width, height } = plan;
  const times = schedule(plan.duration, fps),
    files: ExportFiles = {};
  const originals: Bitmap[] = [];
  progress?.(0, times.length);
  // Collect source pixels once; simulation is identical to the preview.
  for (let i = 0; i < times.length; i++) {
    signal?.throwIfAborted();
    renderer.render(plan.start + times[i].time);
    originals.push({
      width: project.canvas.width,
      height: project.canvas.height,
      rgba: renderer.pixels(),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const palette = pixels.colors
    ? createPalette(sampleFrames(originals), pixels.colors)
    : undefined;
  const layout = plan.atlas;
  const atlas: Bitmap | null = layout
    ? {
        width: layout.width,
        height: layout.height,
        rgba: new Uint8ClampedArray(layout.width * layout.height * 4),
      }
    : null;
  const gif = options.format === "gif" ? GIFEncoder() : null;
  // Reuse a single palette for every animation frame to prevent color flicker.
  const gifFrames: Bitmap[] = [];
  const frames: {
    index: number;
    time: number;
    duration: number;
    rect: { x: number; y: number; width: number; height: number };
    file?: string;
  }[] = [];
  for (let i = 0; i < times.length; i++) {
    signal?.throwIfAborted();
    const frame = processPixels(originals[i], pixels, palette);
    // Release source buffers as soon as their processed frame is available.
    originals[i] = { width: 0, height: 0, rgba: new Uint8ClampedArray() };
    const { time, duration } = times[i];
    const x = layout
      ? (i % layout.columns) * (width + layout.padding * 2) + layout.padding
      : 0;
    const y = layout
      ? Math.floor(i / layout.columns) * (height + layout.padding * 2) +
        layout.padding
      : 0;
    const member = `frames/${String(i).padStart(4, "0")}.png`;
    frames.push({
      index: i,
      time,
      duration,
      rect: { x, y, width, height },
      ...(options.format === "sequence" ? { file: member } : {}),
    });
    if (gif)
      gifFrames.push(
        mattePixels(frame, options.matte ?? project.canvas.background),
      );
    else {
      if (options.format === "sequence") files[member] = encodePng(frame);
      else drawPadded(atlas!, frame, x, y, layout!.padding, options.extrude);
      progress?.(i + 1, times.length);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (gif) {
    const globalPalette = quantize(
      sampleFrames(gifFrames),
      pixels.colors || 256,
    );
    for (let i = 0; i < times.length; i++) {
      signal?.throwIfAborted();
      const frame = gifFrames[i],
        { time, duration } = times[i];
      const indexed = applyPalette(frame.rgba, globalPalette);
      const delay =
        Math.max(
          1,
          Math.round((time + duration) * 100) - Math.round(time * 100),
        ) * 10;
      gif.writeFrame(indexed, width, height, {
        palette: globalPalette,
        delay,
        repeat: project.loop ? 0 : -1,
      });
      gifFrames[i] = { width: 0, height: 0, rgba: new Uint8ClampedArray() };
      progress?.(i + 1, times.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    gif.finish();
    files["animation.gif"] = gif.bytes();
  } else if (atlas) files["atlas.png"] = encodePng(atlas);
  signal?.throwIfAborted();
  if (options.format === "godot") {
    const resources = frames
      .map(
        (f, i) =>
          `[sub_resource type="AtlasTexture" id="Atlas_${i}"]\natlas = ExtResource("1")\nregion = Rect2(${f.rect.x}, ${f.rect.y}, ${width}, ${height})`,
      )
      .join("\n\n");
    const frameDefs = frames
      .map(
        (f, i) =>
          `{\n"duration": ${f.duration * fps},\n"texture": SubResource("Atlas_${i}")\n}`,
      )
      .join(", ");
    files["effect.tres"] = text(
      `[gd_resource type="SpriteFrames" load_steps=${frames.length + 2} format=3]\n\n[ext_resource type="Texture2D" path="atlas.png" id="1"]\n\n${resources}\n\n[resource]\nanimations = [{\n"frames": [${frameDefs}],\n"loop": ${project.loop},\n"name": &"default",\n"speed": ${fps}.0\n}]\n`,
    );
    files["IMPORT.txt"] = text(
      "Godot 4: assign effect.tres to AnimatedSprite2D.sprite_frames. Set Texture Filter to Nearest for pixel art. This is a baked animation.\n",
    );
  }
  if (options.format === "unity") {
    files["Editor/VfxMakerImport.cs"] = text(unityImporter);
    files["IMPORT.txt"] = text(
      "Unity 2022.3+ with 2D Sprite package: place this entire folder in Assets, select metadata.json, then Assets > VFX Maker > Import selected metadata. Creates sliced sprites and a uniquely named AnimationClip. This is a baked animation.\n",
    );
  }
  const portable = {
    ...project,
    editor: { ...project.editor, reference: undefined },
  };
  files["effect.vfx.json"] = text(JSON.stringify(portable, null, 2) + "\n");
  const hashes: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files))
    hashes[name] = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
      ),
    )
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  files["metadata.json"] = text(
    JSON.stringify(
      {
        format: "vfx-maker.export",
        version: VERSION,
        name: project.name,
        renderer:
          options.view === "stage" ? "three-stage-pixi-planes" : "pixi-webgl",
        view: options.view,
        canvas: { ...project.canvas, width, height },
        sourceCanvas: project.canvas,
        output: pixels,
        fps,
        duration: plan.duration,
        sourceRange: { start: plan.start, end: plan.end },
        loop: project.loop,
        atlas: layout
          ? {
              width: layout.width,
              height: layout.height,
              padding: layout.padding,
              extrude: options.extrude,
            }
          : null,
        frames,
        files: hashes,
      },
      null,
      2,
    ) + "\n",
  );
  return files;
}
export function zipExport(files: ExportFiles): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, bytes]) => [
        name,
        [bytes, { mtime: new Date("2020-01-01T00:00:00Z") }],
      ]),
    ),
    { level: 6 },
  );
}
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192)
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(out);
}
const unityImporter = `// VFX Maker ${VERSION} — Unity 2022.3+; requires com.unity.2d.sprite.
using System; using System.IO; using System.Linq; using UnityEditor; using UnityEngine; using UnityEditor.U2D.Sprites;
public static class VfxMakerImport {
 [Serializable] public class RectData { public int x, y, width, height; }
 [Serializable] public class Frame { public int index; public float time, duration; public RectData rect; }
 [Serializable] public class Meta { public string format, version; public float duration, fps; public bool loop; public Frame[] frames; }
 [MenuItem("Assets/VFX Maker/Import selected metadata")]
 public static void Import() {
  var selected = AssetDatabase.GetAssetPath(Selection.activeObject);
  if (Path.GetFileName(selected) != "metadata.json") throw new Exception("Select a VFX Maker metadata.json");
  var meta = JsonUtility.FromJson<Meta>(File.ReadAllText(selected));
  if (meta == null || meta.format != "vfx-maker.export" || meta.version != "${VERSION}" || meta.frames == null || meta.frames.Length == 0 || meta.frames.Length > 300) throw new Exception("Invalid VFX metadata");
  var dir = Path.GetDirectoryName(selected).Replace('\\\\', '/'); var texPath = dir + "/atlas.png";
  var importer = AssetImporter.GetAtPath(texPath) as TextureImporter; if (importer == null) throw new Exception("atlas.png missing");
  importer.textureType = TextureImporterType.Sprite; importer.spriteImportMode = SpriteImportMode.Multiple; importer.filterMode = FilterMode.Point; importer.mipmapEnabled = false; importer.textureCompression = TextureImporterCompression.Uncompressed; importer.alphaIsTransparency = true; importer.npotScale = TextureImporterNPOTScale.None; importer.maxTextureSize = 8192;
  importer.GetSourceTextureWidthAndHeight(out var tw, out var th);
  var factories = new SpriteDataProviderFactories(); factories.Init(); var provider = factories.GetSpriteEditorDataProviderFromObject(importer); provider.InitSpriteEditorDataProvider();
  var previous = provider.GetSpriteRects().ToDictionary(s => s.name, s => s.spriteID);
  var rects = meta.frames.Select(f => { var r = f.rect; if (r == null || r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0 || r.x + r.width > tw || r.y + r.height > th || float.IsNaN(f.time) || float.IsInfinity(f.time) || f.time < 0 || f.duration <= 0 || float.IsNaN(f.duration) || float.IsInfinity(f.duration)) throw new Exception("Invalid frame"); var name = "frame_" + f.index.ToString("D4"); return new SpriteRect { name = name, rect = new Rect(r.x, th - r.y - r.height, r.width, r.height), alignment = SpriteAlignment.Center, pivot = new Vector2(.5f,.5f), spriteID = previous.TryGetValue(name, out var guid) ? guid : GUID.Generate() }; }).ToArray();
  provider.SetSpriteRects(rects); var names = provider.GetDataProvider<ISpriteNameFileIdDataProvider>(); names.SetNameFileIdPairs(rects.Select(r => new SpriteNameFileIdPair(r.name, r.spriteID))); provider.Apply(); importer.SaveAndReimport();
  var sprites = AssetDatabase.LoadAllAssetsAtPath(texPath).OfType<Sprite>().OrderBy(s => s.name).ToArray(); if (sprites.Length != meta.frames.Length) throw new Exception("Sprite slicing failed");
  var keys = meta.frames.Select((f,i) => new ObjectReferenceKeyframe { time = f.time, value = sprites[i] }).ToList(); keys.Add(new ObjectReferenceKeyframe { time = meta.duration, value = sprites.Last() });
  var clip = new AnimationClip { frameRate = meta.fps }; AnimationUtility.SetObjectReferenceCurve(clip, EditorCurveBinding.PPtrCurve("", typeof(SpriteRenderer), "m_Sprite"), keys.ToArray()); var settings = AnimationUtility.GetAnimationClipSettings(clip); settings.loopTime = meta.loop; AnimationUtility.SetAnimationClipSettings(clip, settings); AssetDatabase.CreateAsset(clip, AssetDatabase.GenerateUniqueAssetPath(dir + "/effect.anim")); AssetDatabase.SaveAssets();
 }
}
`;
