// VFX Maker exporter integration. Requires Unity 2022.3+ and com.unity.2d.sprite.
using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.U2D.Sprites;
using UnityEngine;

namespace VfxMaker.Editor
{
    public static class VfxMakerImport
    {
        [Serializable] public class Size { public int width, height; }
        [Serializable] public class RectData { public int x, y, width, height; }
        [Serializable] public class Frame { public int index; public string file; public RectData rect; public double time_seconds, duration_ms; }
        [Serializable] public class Manifest
        {
            public string format, export_format, texture_filter;
            public int schema_version, fps;
            public double duration_seconds;
            public bool loop;
            public Size atlas_size;
            public Frame[] frames;
        }

        [MenuItem("Assets/VFX Maker/Import selected metadata")]
        public static void ImportSelected()
        {
            var metadataPath = AssetDatabase.GetAssetPath(Selection.activeObject);
            if (!metadataPath.StartsWith("Assets/", StringComparison.Ordinal) || Path.GetFileName(metadataPath) != "metadata.json")
                throw new InvalidOperationException("Select the exported metadata.json under Assets first.");
            Import(metadataPath);
        }

        // Public entry point for editor automation; all timing comes from the export manifest.
        public static AnimationClip Import(string metadataPath)
        {
            metadataPath = metadataPath.Replace('\\', '/');
            var full = Path.GetFullPath(metadataPath);
            var assets = Path.GetFullPath(Application.dataPath) + Path.DirectorySeparatorChar;
            if (!full.StartsWith(assets, StringComparison.Ordinal) || !metadataPath.StartsWith("Assets/", StringComparison.Ordinal))
                throw new InvalidOperationException("Metadata must be inside this project's Assets directory.");
            var data = JsonUtility.FromJson<Manifest>(File.ReadAllText(full));
            if (data == null || data.format != "vfxmaker.export" || data.schema_version != 1 || data.export_format != "unity" || data.atlas_size == null || data.frames == null || data.frames.Length == 0 || data.frames.Length > 300 || data.fps < 1 || data.fps > 60 || double.IsNaN(data.duration_seconds) || double.IsInfinity(data.duration_seconds) || data.duration_seconds <= 0 || data.duration_seconds > 10 || data.atlas_size.width <= 0 || data.atlas_size.height <= 0 || data.atlas_size.width > 8192 || data.atlas_size.height > 8192)
                throw new InvalidOperationException("Unsupported VFX Maker Unity manifest.");
            foreach (var frame in data.frames)
                if (frame.file != "atlas.png" || frame.rect == null || frame.rect.x < 0 || frame.rect.y < 0 || frame.rect.width <= 0 || frame.rect.height <= 0 || (long)frame.rect.x + frame.rect.width > data.atlas_size.width || (long)frame.rect.y + frame.rect.height > data.atlas_size.height || double.IsNaN(frame.time_seconds) || double.IsInfinity(frame.time_seconds) || double.IsNaN(frame.duration_ms) || double.IsInfinity(frame.duration_ms) || frame.time_seconds < 0 || frame.time_seconds >= data.duration_seconds || frame.duration_ms <= 0)
                    throw new InvalidOperationException("Invalid atlas rectangle or frame timing.");
            for (var i = 0; i < data.frames.Length; i++)
                if (data.frames[i].index != i || (i > 0 && data.frames[i].time_seconds <= data.frames[i - 1].time_seconds))
                    throw new InvalidOperationException("Frames must have consecutive indices and increasing sample times.");
            for (var i = 0; i < data.frames.Length; i++)
            {
                var end = i + 1 < data.frames.Length ? data.frames[i + 1].time_seconds : data.duration_seconds;
                if (Math.Abs(data.frames[i].time_seconds + data.frames[i].duration_ms / 1000.0 - end) > 0.000001)
                    throw new InvalidOperationException("Frame timing is inconsistent with the animation duration.");
            }
            var folder = Path.GetDirectoryName(metadataPath).Replace('\\', '/');
            var atlasPath = folder + "/atlas.png";
            AssetDatabase.ImportAsset(atlasPath, ImportAssetOptions.ForceSynchronousImport);
            var importer = AssetImporter.GetAtPath(atlasPath) as TextureImporter;
            if (importer == null) throw new InvalidOperationException("atlas.png was not imported as a texture.");
            importer.textureType = TextureImporterType.Sprite;
            importer.spriteImportMode = SpriteImportMode.Multiple;
            importer.spritePixelsPerUnit = 100;
            importer.filterMode = data.texture_filter == "nearest" ? FilterMode.Point : FilterMode.Bilinear;
            importer.mipmapEnabled = false;
            importer.alphaIsTransparency = true;
            importer.textureCompression = TextureImporterCompression.Uncompressed;
            importer.npotScale = TextureImporterNPOTScale.None;
            importer.wrapMode = TextureWrapMode.Clamp;
            importer.maxTextureSize = 8192;
            var factories = new SpriteDataProviderFactories();
            factories.Init();
            var provider = factories.GetSpriteEditorDataProviderFromObject(importer);
            if (provider == null) throw new InvalidOperationException("Install Unity's 2D Sprite package (com.unity.2d.sprite).");
            provider.InitSpriteEditorDataProvider();
            var previous = provider.GetSpriteRects().ToDictionary(r => r.name, r => r.spriteID);
            var rects = data.frames.Select(f => {
                var name = "frame_" + f.index.ToString("D4");
                return new SpriteRect {
                    name = name,
                    spriteID = previous.TryGetValue(name, out var id) ? id : GUID.Generate(),
                    rect = new Rect(f.rect.x, data.atlas_size.height - f.rect.y - f.rect.height, f.rect.width, f.rect.height),
                    alignment = SpriteAlignment.Custom, pivot = new Vector2(0.5f, 0.5f)
                };
            }).ToArray();
            provider.SetSpriteRects(rects);
            var names = provider.GetDataProvider<ISpriteNameFileIdDataProvider>();
            if (names != null) names.SetNameFileIdPairs(rects.Select(r => new SpriteNameFileIdPair(r.name, r.spriteID)));
            provider.Apply();
            importer.SaveAndReimport();
            var sprites = AssetDatabase.LoadAllAssetsAtPath(atlasPath).OfType<Sprite>().ToDictionary(s => s.name);
            if (sprites.Count != data.frames.Length) throw new InvalidOperationException("Sprite import changed the frame count.");
            var keys = data.frames.Select(f => new ObjectReferenceKeyframe { time = (float)f.time_seconds, value = sprites["frame_" + f.index.ToString("D4")] }).ToList();
            // A terminal hold key preserves the last frame's duration.
            keys.Add(new ObjectReferenceKeyframe { time = (float)data.duration_seconds, value = keys[keys.Count - 1].value });
            var clip = new AnimationClip { frameRate = data.fps };
            var binding = new EditorCurveBinding { type = typeof(SpriteRenderer), path = "", propertyName = "m_Sprite" };
            AnimationUtility.SetObjectReferenceCurve(clip, binding, keys.ToArray());
            var settings = AnimationUtility.GetAnimationClipSettings(clip);
            settings.loopTime = data.loop;
            AnimationUtility.SetAnimationClipSettings(clip, settings);
            var clipPath = AssetDatabase.GenerateUniqueAssetPath(folder + "/effect.anim");
            AssetDatabase.CreateAsset(clip, clipPath);
            AssetDatabase.SaveAssets();
            EditorGUIUtility.PingObject(clip);
            return clip;
        }
    }
}
