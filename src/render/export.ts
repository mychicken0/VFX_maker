import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { zipSync } from "fflate";
import { parseProject, type Project } from "../core/model.js";
import { VfxRenderer } from "./pixi.js";

import {
  exportOptionsSchema,
  atlasLayout,
  type ExportOptions,
} from "../core/export-options.js";
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
function canvas(width: number, height: number) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}
async function png(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))),
      "image/png",
    ),
  );
  return new Uint8Array(await blob.arrayBuffer());
}
function rgbaCanvas(pixels: Uint8ClampedArray, width: number, height: number) {
  const c = canvas(width, height);
  c.getContext("2d")!.putImageData(
    new ImageData(new Uint8ClampedArray(pixels), width, height),
    0,
    0,
  );
  return c;
}
export async function preview(
  renderer: VfxRenderer,
  project: Project,
  time: number,
): Promise<Uint8Array> {
  if (!Number.isFinite(time) || time < 0 || time > project.duration)
    throw new Error("Preview time is outside the effect duration");
  renderer.render(time);
  return png(
    rgbaCanvas(renderer.pixels(), project.canvas.width, project.canvas.height),
  );
}
export async function exportEffect(
  renderer: VfxRenderer,
  value: Project,
  input: ExportOptions = {},
  progress?: Progress,
  signal?: AbortSignal,
): Promise<ExportFiles> {
  const project = parseProject(value),
    options = exportOptionsSchema.parse(input);
  const fps = options.fps ?? project.fps,
    times = schedule(project.duration, fps);
  const { width, height } = project.canvas;
  if (times.length > 300 || times.length * width * height > 16777216)
    throw new Error(
      "Export budget exceeded (300 frames / 16 million source pixels)",
    );
  if (
    options.format === "gif" &&
    times.length * width * height * options.scale ** 2 > 33554432
  )
    throw new Error("GIF scale exceeds the 32 million pixel export budget");
  const files: ExportFiles = {},
    layout = atlasLayout(width, height, times.length);
  const { columns, padding } = layout;
  const atlas = canvas(layout.width, layout.height);
  const ctx = atlas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const gif = options.format === "gif" ? GIFEncoder() : null;
  const matte = options.matte ?? project.canvas.background;
  const frames: {
    index: number;
    time: number;
    duration: number;
    rect: { x: number; y: number; width: number; height: number };
  }[] = [];
  for (let i = 0; i < times.length; i++) {
    signal?.throwIfAborted();
    const { time, duration } = times[i];
    renderer.render(time);
    const frame = rgbaCanvas(renderer.pixels(), width, height);
    const x = (i % columns) * (width + padding * 2) + padding,
      y = Math.floor(i / columns) * (height + padding * 2) + padding;
    frames.push({ index: i, time, duration, rect: { x, y, width, height } });
    if (gif) {
      const scaled = canvas(width * options.scale, height * options.scale),
        sc = scaled.getContext("2d")!;
      sc.imageSmoothingEnabled = false;
      sc.fillStyle = matte;
      sc.fillRect(0, 0, scaled.width, scaled.height);
      sc.drawImage(frame, 0, 0, scaled.width, scaled.height);
      const rgba = sc.getImageData(0, 0, scaled.width, scaled.height).data,
        palette = quantize(rgba, 256),
        indexed = applyPalette(rgba, palette);
      // Quantize cumulative endpoints, so centisecond rounding does not drift.
      const delay =
        Math.max(
          1,
          Math.round((time + duration) * 100) - Math.round(time * 100),
        ) * 10;
      gif.writeFrame(indexed, scaled.width, scaled.height, {
        palette,
        delay,
        repeat: project.loop ? 0 : -1,
      });
    } else if (options.format === "sequence")
      files[`frames/${String(i).padStart(4, "0")}.png`] = await png(frame);
    else ctx.drawImage(frame, x, y);
    progress?.(i + 1, times.length);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  signal?.throwIfAborted();
  if (gif) {
    gif.finish();
    files["animation.gif"] = gif.bytes();
  } else if (options.format !== "sequence")
    files["atlas.png"] = await png(atlas);
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
      "Godot 4: place this folder in your project. Assign effect.tres to AnimatedSprite2D.sprite_frames. For pixel art set Texture Filter to Nearest. This is a baked animation.\n",
    );
  }
  if (options.format === "unity") {
    files["Editor/VfxMakerImport.cs"] = text(unityImporter);
    files["IMPORT.txt"] = text(
      "Unity 2022.3+ with 2D Sprite package: place this entire export folder in Assets, select metadata.json, then Assets > VFX Maker > Import selected metadata. Creates sliced sprites and a uniquely named AnimationClip. This is a baked animation.\n",
    );
  }
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
        version: "0.4.0",
        name: project.name,
        renderer: "pixi-webgl",
        canvas: project.canvas,
        fps,
        duration: project.duration,
        loop: project.loop,
        atlas:
          options.format !== "gif" && options.format !== "sequence"
            ? { width: atlas.width, height: atlas.height, padding }
            : null,
        frames,
        files: hashes,
      },
      null,
      2,
    ) + "\n",
  );
  files["effect.vfx.json"] = text(JSON.stringify(project, null, 2) + "\n");
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
const unityImporter = `// VFX Maker 0.4.0 — Unity 2022.3+; requires com.unity.2d.sprite.
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
  if (meta == null || meta.format != "vfx-maker.export" || meta.version != "0.4.0" || meta.frames == null || meta.frames.Length == 0 || meta.frames.Length > 300) throw new Exception("Invalid VFX metadata");
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
