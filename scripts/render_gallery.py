#!/usr/bin/env python3
"""Render any discovered recipes through the standalone CLI, without effect-specific logic."""
import argparse
import html
import json
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vfx", default="vfx")
    parser.add_argument("--out", type=Path, required=True, help="New output directory")
    parser.add_argument("--fps", type=int, default=25)
    parser.add_argument("--scale", type=int, default=3)
    parser.add_argument("--background", default="#100811")
    parser.add_argument("--preset", action="append", help="Optional subset; may be repeated")
    args = parser.parse_args()
    root = args.out.absolute()
    root.mkdir(parents=True, exist_ok=False)

    def cli(*command):
        process = subprocess.run([args.vfx, "--root", str(root), "--json", *command],
                                 check=True, capture_output=True, text=True)
        return json.loads(process.stdout)["data"]

    catalog = cli("preset", "list")
    if args.preset:
        unknown = set(args.preset) - {p["id"] for p in catalog}
        if unknown:
            parser.error("Unknown recipes: " + ", ".join(sorted(unknown)))
        catalog = [p for p in catalog if p["id"] in args.preset]
    rendered = []
    for preset in catalog:
        ident = preset["id"]
        folder = root / ident
        folder.mkdir()
        canvas = preset["canvas"]
        command = ["new", f"{ident}/effect.vfxproj", "--preset", ident,
                   "--canvas", f"{canvas['width']}x{canvas['height']}"]
        if not canvas["pixel_mode"]:
            command.append("--smooth")
        project = cli(*command)
        duration = project["scene"]["simulation"]["duration_seconds"]
        times = ",".join(str(duration*t) for t in [0.1, 0.3, 0.55, 0.75])
        preview = cli("preview", f"{ident}/effect.vfxproj", "--times", times,
                      "--out", f"{ident}/preview.png")
        gif = cli("export", f"{ident}/effect.vfxproj", "--format", "gif",
                  "--fps", str(args.fps), "--scale", str(args.scale),
                  "--background", args.background, "--out", f"{ident}/gif")
        atlas = cli("export", f"{ident}/effect.vfxproj", "--format", "spritesheet",
                    "--fps", str(args.fps), "--out", f"{ident}/atlas")
        rendered.append({"preset": preset, "gif": gif, "atlas": atlas, "preview": preview})
        print(f"Rendered {ident}: {gif['frame_count']} frames", flush=True)

    (root / "gallery.json").write_text(json.dumps(rendered, indent=2) + "\n")
    cards = []
    for item in rendered:
        p = item["preset"]
        ident = html.escape(p["id"], quote=True)
        description = html.escape(p["description"])
        cards.append(f'''<article><img src="{ident}/gif/animation.gif" alt="{description}">
<div class="body"><h2>{ident.replace('_', ' ')}</h2><p>{description}</p>
<span>{item['gif']['frame_count']} frames · {args.fps} FPS · {p['canvas']['width']}×{p['canvas']['height']}</span>
<nav><a href="{ident}/gif/animation.gif" download>GIF</a><a href="{ident}/atlas/atlas.png" download>Transparent atlas</a><a href="{ident}/effect.vfxproj" download>Editable project</a></nav></div></article>''')
    page = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VFX Maker — rendered gallery</title><style>
*{box-sizing:border-box}body{margin:0;background:#0b0c12;color:#e9e8ee;font:15px system-ui,sans-serif}
header{max-width:1280px;margin:auto;padding:56px 24px 32px}small{color:#ff657e;letter-spacing:.16em;text-transform:uppercase}
h1{font-size:clamp(32px,5vw,58px);line-height:1.05;margin:14px 0}header p{max-width:780px;line-height:1.7;color:#aaa9ba}
main{max-width:1280px;margin:auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:20px;padding:0 24px 48px}
article{border:1px solid #292837;border-radius:16px;background:#13131e;overflow:hidden}article img{width:100%;height:260px;object-fit:contain;background:#100811;image-rendering:pixelated}
.body{padding:20px}h2{font-size:20px;text-transform:capitalize;margin:0 0 10px}.body p{color:#aaa9ba;line-height:1.5;min-height:44px}span{font-size:12px;color:#858497}
nav{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px}a{color:#ff8ba0;font-size:12px;text-decoration:none}a:hover{text-decoration:underline}
footer{max-width:1280px;margin:auto;padding:0 24px 40px;color:#858497;font-size:13px}
</style><header><small>VFX Maker · effect library</small><h1>Pick an effect. Make it yours.</h1><p>Explore the animations, then download an editable project or a ready-to-use asset. GIF previews use an opaque background; PNG atlases retain transparency. Adjust colors, timing and particle behavior through the recipe and project tools.</p></header><main>'''
    page += "\n".join(cards)
    page += '</main><footer>Inspect gallery.json and each atlas/metadata.json for timing, frame rectangles, seed, backend and content hashes. GIF repetition is preview playback, not a seamless-loop guarantee.</footer></html>'
    (root / "index.html").write_text(page)
    print(root / "index.html")


if __name__ == "__main__":
    main()
