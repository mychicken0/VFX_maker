import * as THREE from "three";
import { VfxRenderer } from "./pixi.js";
import type { EffectRenderer } from "./types.js";
import { parseProject, type Project } from "../core/model.js";
import {
  stageDefaults,
  stagePlacementSchema,
  type Stage,
} from "../core/stage.js";

/** Real camera projection of the same deterministic Pixi layer frames. */
export class StageRenderer implements EffectRenderer {
  readonly view = "stage" as const;
  private readonly scene = new THREE.Scene();
  private readonly gpu = new THREE.WebGLRenderer({
    alpha: true,
    antialias: false,
    preserveDrawingBuffer: true,
    premultipliedAlpha: false,
  });
  private camera: THREE.Camera = new THREE.PerspectiveCamera();
  private readonly guides = new THREE.Group();
  private readonly meshes = new Map<
    string,
    {
      mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
      texture: THREE.DataTexture;
    }
  >();
  private project!: Project;
  private key = "";
  private disposed = false;
  private generation = 0;
  private constructor(private readonly base: VfxRenderer) {
    this.gpu.setPixelRatio(1);
    this.gpu.setClearColor(0, 0);
    this.gpu.outputColorSpace = THREE.SRGBColorSpace;
    this.gpu.toneMapping = THREE.NoToneMapping;
    const grid = new THREE.GridHelper(384, 24, 0x8e6cba, 0x343443),
      axes = new THREE.AxesHelper(64);
    this.guides.add(grid, axes);
    this.guides.visible = false;
    this.scene.add(this.guides);
  }
  static async create() {
    const base = await VfxRenderer.create();
    try {
      return new StageRenderer(base);
    } catch (error) {
      base.destroy();
      throw error;
    }
  }
  get canvas() {
    return this.gpu.domElement;
  }
  setGuides(visible: boolean) {
    this.guides.visible = visible;
  }
  private clearPlanes() {
    for (const { mesh, texture } of this.meshes.values()) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      texture.dispose();
      this.scene.remove(mesh);
    }
    this.meshes.clear();
  }
  async setProject(value: Project) {
    const project = parseProject(value),
      key = JSON.stringify(project);
    if (key === this.key) return;
    const generation = ++this.generation,
      { stage: _stage, ...effect } = project;
    await this.base.setProject(effect);
    if (this.disposed || generation !== this.generation) return;
    const stage = project.stage ?? stageDefaults();
    const geometryChanged =
      !this.project ||
      this.project.canvas.width !== project.canvas.width ||
      this.project.canvas.height !== project.canvas.height ||
      this.project.layers.map((l) => l.id).join("|") !==
        project.layers.map((l) => l.id).join("|");
    this.project = project;
    this.key = key;
    this.gpu.setSize(project.canvas.width, project.canvas.height, false);
    if (geometryChanged) {
      this.clearPlanes();
      for (const l of project.layers) {
        const texture = new THREE.DataTexture(
          new Uint8Array(project.canvas.width * project.canvas.height * 4),
          project.canvas.width,
          project.canvas.height,
        );
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.magFilter = texture.minFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(project.canvas.width, project.canvas.height),
          new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            toneMapped: false,
          }),
        );
        this.scene.add(mesh);
        this.meshes.set(l.id, { mesh, texture });
      }
    }
    this.configure(stage);
  }
  private configure(stage: Stage) {
    const p = this.project,
      aspect = p.canvas.width / p.canvas.height;
    this.camera =
      stage.projection === "orthographic"
        ? new THREE.OrthographicCamera(
            (-stage.span * aspect) / 2,
            (stage.span * aspect) / 2,
            stage.span / 2,
            -stage.span / 2,
            0.1,
            32768,
          )
        : new THREE.PerspectiveCamera(stage.fov, aspect, 0.1, 32768);
    const azimuth = THREE.MathUtils.degToRad(stage.azimuth),
      elevation = THREE.MathUtils.degToRad(stage.elevation),
      target = new THREE.Vector3(
        stage.target.x,
        stage.target.y,
        stage.target.z,
      );
    this.camera.position.set(
      target.x + stage.distance * Math.sin(azimuth) * Math.cos(elevation),
      target.y + stage.distance * Math.sin(elevation),
      target.z + stage.distance * Math.cos(azimuth) * Math.cos(elevation),
    );
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
    for (const [index, l] of p.layers.entries()) {
      const { mesh } = this.meshes.get(l.id)!,
        placement =
          stage.layers[l.id] ??
          stagePlacementSchema.parse({ plane: stage.plane });
      mesh.position.set(
        placement.position.x,
        placement.position.y +
          (placement.plane === "ground" ? index * 0.02 : 0),
        placement.position.z +
          (placement.plane === "ground" ? 0 : index * 0.02),
      );
      mesh.quaternion.identity();
      if (placement.plane === "billboard")
        mesh.quaternion.copy(this.camera.quaternion);
      else if (placement.plane === "ground") mesh.rotation.x = -Math.PI / 2;
      mesh.rotateX(THREE.MathUtils.degToRad(placement.rotation.x));
      mesh.rotateY(THREE.MathUtils.degToRad(placement.rotation.y));
      mesh.rotateZ(THREE.MathUtils.degToRad(placement.rotation.z));
      mesh.scale.setScalar(placement.scale);
      mesh.renderOrder = stage.mode === "3d" ? 0 : index;
      mesh.material.blending =
        l.blend === "add" ? THREE.AdditiveBlending : THREE.NormalBlending;
    }
  }
  render(time: number, ids?: ReadonlySet<string>) {
    if (this.disposed || !this.project) return;
    const p = this.project;
    for (const l of p.layers) {
      const { mesh, texture } = this.meshes.get(l.id)!;
      mesh.visible = l.visible && (!ids || ids.has(l.id));
      if (!mesh.visible) continue;
      this.base.render(time, new Set([l.id]));
      const rgba = this.base.pixels(),
        data = texture.image.data as Uint8Array,
        row = p.canvas.width * 4;
      for (let y = 0; y < p.canvas.height; y++)
        data.set(
          rgba.subarray(y * row, (y + 1) * row),
          (p.canvas.height - y - 1) * row,
        );
      texture.needsUpdate = true;
    }
    this.gpu.render(this.scene, this.camera);
  }
  pixels(): Uint8ClampedArray {
    const { width, height } = this.project.canvas,
      gl = this.gpu.getContext(),
      raw = new Uint8Array(width * height * 4),
      result = new Uint8ClampedArray(raw.length);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    const row = width * 4;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < row; x += 4) {
        const src = (height - y - 1) * row + x,
          dest = y * row + x,
          alpha = raw[src + 3];
        result[dest + 3] = alpha;
        for (let c = 0; c < 3; c++)
          result[dest + c] = alpha
            ? Math.min(255, Math.round((raw[src + c] * 255) / alpha))
            : 0;
      }
    return result;
  }
  destroy() {
    this.disposed = true;
    this.clearPlanes();
    this.guides.traverse((o) => {
      if (o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of materials) m.dispose();
      }
    });
    this.base.destroy();
    this.gpu.dispose();
    this.gpu.forceContextLoss();
    this.canvas.remove();
  }
}
