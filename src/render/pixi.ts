import "pixi.js/unsafe-eval";
import {
  Application,
  BlurFilter,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
} from "pixi.js";
import { pathPolyline } from "../core/geometry.js";
import type { Vec, Asset, Project } from "../core/model.js";
import { parseProject } from "../core/model.js";
import {
  clamp,
  colorAt,
  evaluate,
  frameIndex,
  pointOnPath,
} from "../core/math.js";
import { localTime, ParticleSampler } from "../core/simulation.js";

interface View {
  root: Container;
  body: Container;
  halo: Container;
  graphics: Graphics;
  path?: Vec[];
  sprites: Sprite[];
  haloSprites: Sprite[];
}
/** Browser preview and headless export both use this Pixi WebGL renderer. */
export class VfxRenderer {
  readonly app = new Application();
  private project!: Project;
  private sampler!: ParticleSampler;
  private views = new Map<string, View>();
  private textures = new Map<string, Texture[]>();
  private sources: Texture[] = [];
  private generation = 0;
  private disposed = false;
  static async create(canvas?: HTMLCanvasElement): Promise<VfxRenderer> {
    const r = new VfxRenderer();
    await r.app.init({
      canvas,
      width: 128,
      height: 128,
      preference: "webgl",
      antialias: false,
      resolution: 1,
      autoStart: false,
      sharedTicker: false,
      backgroundAlpha: 0,
      preserveDrawingBuffer: true,
    });
    r.app.stop();
    return r;
  }
  get canvas(): HTMLCanvasElement {
    return this.app.canvas as HTMLCanvasElement;
  }
  async setProject(value: Project): Promise<void> {
    const project = parseProject(value),
      generation = ++this.generation;
    // Decode and verify every texture before changing the live scene.
    const images = await Promise.all(
      project.assets.map(async (a) => {
        const image = new Image();
        image.src = a.data;
        await image.decode();
        if (image.naturalWidth !== a.width || image.naturalHeight !== a.height)
          throw new Error(
            `Texture ${a.id}: declared dimensions do not match its PNG`,
          );
        return image;
      }),
    );
    if (generation !== this.generation || this.disposed) return;
    this.clear();
    this.project = project;
    this.sampler = new ParticleSampler(project);
    this.app.renderer.resize(project.canvas.width, project.canvas.height);
    project.assets.forEach((a, i) => {
      const base = Texture.from(images[i]);
      base.source.scaleMode = project.canvas.pixelArt ? "nearest" : "linear";
      this.sources.push(base);
      this.textures.set(a.id, this.slice(base, a));
    });
    for (const layer of project.layers) {
      const root = new Container(),
        halo = new Container(),
        body = new Container(),
        graphics = new Graphics();
      body.addChild(graphics);
      halo.addChild(new Graphics({ context: graphics.context }));
      halo.filters =
        layer.glow.strength > 0
          ? [
              new BlurFilter({
                strength: Math.max(0.1, layer.glow.blur),
                quality: 3,
              }),
            ]
          : [];
      halo.blendMode = "add";
      halo.alpha = layer.glow.strength;
      halo.visible = layer.glow.strength > 0;
      root.addChild(halo, body);
      if (layer.mask) {
        const mask = new Graphics(),
          m = layer.mask;
        if (m.shape === "rectangle")
          mask
            .rect(
              m.position.x - m.width / 2,
              m.position.y - m.height / 2,
              m.width,
              m.height,
            )
            .fill(0xffffff);
        else if (m.shape === "ellipse")
          mask
            .ellipse(m.position.x, m.position.y, m.width / 2, m.height / 2)
            .fill(0xffffff);
        else
          mask
            .poly(
              m.points.flatMap((p) => [p.x + m.position.x, p.y + m.position.y]),
            )
            .fill(0xffffff);
        root.addChild(mask);
        root.mask = mask;
      }
      root.position.set(layer.position.x, layer.position.y);
      root.rotation = (layer.rotation * Math.PI) / 180;
      root.scale.set(layer.scale);
      root.blendMode = layer.blend;
      this.app.stage.addChild(root);
      this.views.set(layer.id, {
        root,
        halo,
        body,
        graphics,
        path: layer.type === "path" ? pathPolyline(layer) : undefined,
        sprites: [],
        haloSprites: [],
      });
    }
  }
  private slice(base: Texture, a: Asset): Texture[] {
    return Array.from(
      { length: a.frames },
      (_, i) =>
        new Texture({
          source: base.source,
          frame: new Rectangle(
            ((i % a.columns) * a.width) / a.columns,
            (Math.floor(i / a.columns) * a.height) / a.rows,
            a.width / a.columns,
            a.height / a.rows,
          ),
        }),
    );
  }
  render(time: number): void {
    if (!this.project || this.disposed) return;
    if (!Number.isFinite(time)) throw new Error("Time must be finite");
    for (const l of this.project.layers) {
      const v = this.views.get(l.id)!,
        t = localTime(l, time);
      v.graphics.clear();
      v.sprites.forEach((s) => (s.visible = false));
      v.haloSprites.forEach((s) => (s.visible = false));
      v.root.visible = l.visible && t !== null;
      if (!v.root.visible || t === null) continue;
      const u = t / l.duration;
      v.root.position.set(
        l.position.x + evaluate(l.motion.x, u),
        l.position.y + evaluate(l.motion.y, u),
      );
      v.root.rotation =
        ((l.rotation + evaluate(l.motion.rotation, u)) * Math.PI) / 180;
      v.root.scale.set(l.scale * evaluate(l.motion.scale, u));
      v.root.alpha = l.type === "particles" ? 1 : clamp(evaluate(l.opacity, u));
      if (l.type === "particles") {
        const particles = this.sampler.sample(l, time);
        particles.forEach((p, i) => {
          if (p.size <= 0 || p.alpha <= 0) return;
          const x = this.project.canvas.pixelArt ? Math.round(p.x) : p.x,
            y = this.project.canvas.pixelArt ? Math.round(p.y) : p.y;
          if (l.shape === "sprite" && l.asset) {
            const textures = this.textures.get(l.asset)!;
            this.drawSprite(
              v,
              i,
              textures[
                frameIndex(
                  l.frameMode,
                  p.age,
                  p.life,
                  l.frameFps,
                  textures.length,
                )
              ],
              x,
              y,
              p.size * 2,
              p.size * 2,
              p.rotation,
              p.color,
              p.alpha,
            );
          } else if (l.shape === "circle")
            v.graphics
              .circle(x, y, p.size)
              .fill({ color: p.color, alpha: p.alpha });
          else {
            const length = p.size * (l.shape === "spark" ? l.stretch : 1),
              width = p.size;
            const cos = Math.cos(p.rotation),
              sin = Math.sin(p.rotation);
            const corners = [
              [-length, -width],
              [length, -width],
              [length, width],
              [-length, width],
            ].flatMap(([a, b]) => [
              x + a * cos - b * sin,
              y + a * sin + b * cos,
            ]);
            v.graphics.poly(corners).fill({ color: p.color, alpha: p.alpha });
          }
        });
      } else if (l.type === "path") {
        const pts = v.path!;
        const progress = clamp(evaluate(l.draw, u)),
          width = Math.max(0, evaluate(l.width, u)),
          color = colorAt(l.colors, u);
        const steps = Math.max(2, Math.ceil(128 * progress));
        for (let i = 0; i < steps && progress > 0 && width > 0; i++) {
          const a = (i / steps) * progress,
            b = ((i + 1) / steps) * progress,
            p = pointOnPath(pts, a),
            q = pointOnPath(pts, b);
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d < 1e-8) continue;
          const nx = -(q.y - p.y) / d,
            ny = (q.x - p.x) / d;
          const taper = (f: number) =>
            (width / 2) *
            (1 -
              l.taper +
              l.taper * Math.pow(Math.max(0, Math.sin(f * Math.PI)), 0.65));
          const wa = taper(a),
            wb = taper(b);
          v.graphics
            .poly([
              p.x + nx * wa,
              p.y + ny * wa,
              q.x + nx * wb,
              q.y + ny * wb,
              q.x - nx * wb,
              q.y - ny * wb,
              p.x - nx * wa,
              p.y - ny * wa,
            ])
            .fill(color);
        }
      } else if (l.type === "ring") {
        const radius = Math.max(0, evaluate(l.radius, u)),
          width = Math.max(0, evaluate(l.width, u));
        if (width > 0) {
          for (let i = 0; i <= l.segments; i++) {
            const a = ((i / l.segments) * l.arc * Math.PI) / 180,
              x = Math.cos(a) * radius,
              y = Math.sin(a) * radius;
            if (i === 0) v.graphics.moveTo(x, y);
            else v.graphics.lineTo(x, y);
          }
          v.graphics.stroke({
            width,
            color: colorAt(l.colors, u),
            cap: "round",
            join: "round",
          });
        }
      } else {
        const textures = this.textures.get(l.asset)!;
        this.drawSprite(
          v,
          0,
          textures[
            frameIndex(l.frameMode, t, l.duration, l.frameFps, textures.length)
          ],
          0,
          0,
          Math.max(0, evaluate(l.width, u)),
          Math.max(0, evaluate(l.height, u)),
          0,
          colorAt(l.colors, u),
          1,
        );
      }
    }
    this.app.renderer.render(this.app.stage);
  }
  private drawSprite(
    v: View,
    i: number,
    texture: Texture,
    x: number,
    y: number,
    width: number,
    height: number,
    rotation: number,
    color: number,
    alpha: number,
  ) {
    for (const [container, pool] of [
      [v.body, v.sprites],
      [v.halo, v.haloSprites],
    ] as const) {
      let s = pool[i];
      if (!s) {
        s = new Sprite(texture);
        s.anchor.set(0.5);
        pool[i] = s;
        container.addChild(s);
      }
      s.texture = texture;
      s.position.set(x, y);
      s.width = width;
      s.height = height;
      s.rotation = rotation;
      s.tint = color;
      s.alpha = alpha;
      s.visible = true;
    }
  }
  /** Read actual rendered pixels, including filters and alpha. */
  pixels(): Uint8ClampedArray {
    const { pixels } = this.app.renderer.extract.pixels({
      target: this.app.stage,
      frame: new Rectangle(
        0,
        0,
        this.project.canvas.width,
        this.project.canvas.height,
      ),
      resolution: 1,
      antialias: false,
    });
    // Pixi's WebGL readback contains premultiplied color. PNG/ImageData expect
    // straight RGBA; otherwise translucent edges get multiplied a second time.
    const rgba = new Uint8ClampedArray(pixels);
    for (let i = 0; i < rgba.length; i += 4) {
      const alpha = rgba[i + 3];
      if (alpha === 0) {
        rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
      } else if (alpha < 255) {
        for (let c = 0; c < 3; c++)
          rgba[i + c] = Math.round((rgba[i + c] * 255) / alpha);
      }
    }
    return rgba;
  }
  private clear() {
    for (const v of this.views.values()) {
      for (const f of v.halo.filters ?? []) f.destroy();
      const context = v.graphics.context;
      v.root.destroy({ children: true });
      context.destroy();
    }
    this.views.clear();
    for (const textures of this.textures.values())
      for (const t of textures) t.destroy();
    this.textures.clear();
    for (const t of this.sources) t.destroy(true);
    this.sources = [];
  }
  destroy() {
    this.disposed = true;
    this.generation++;
    this.clear();
    this.app.destroy(false);
  }
}
