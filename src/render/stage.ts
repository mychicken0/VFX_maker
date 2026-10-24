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
  private readonly gpu: THREE.WebGLRenderer;
  private viewport?: { width: number; height: number };
  private editorView?: Stage;
  private effectKey = "";
  private textureKey = "";
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
  private constructor(
    private readonly base: VfxRenderer,
    private readonly editor = false,
  ) {
    this.gpu = new THREE.WebGLRenderer({
      alpha: true,
      antialias: editor,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
    });
    this.gpu.setPixelRatio(1);
    this.gpu.setClearColor(0, 0);
    this.gpu.outputColorSpace = THREE.SRGBColorSpace;
    this.gpu.toneMapping = THREE.NoToneMapping;
    const grid = new THREE.GridHelper(384, 24, 0x8e6cba, 0x343443),
      axes = new THREE.AxesHelper(64);
    grid.renderOrder = -1000;
    for (const material of Array.isArray(grid.material)
      ? grid.material
      : [grid.material]) {
      material.transparent = true;
      material.opacity = 0.13;
      material.depthWrite = false;
      material.depthTest = false;
    }
    axes.visible = false;
    this.guides.add(grid, axes);
    this.guides.visible = false;
    this.scene.add(this.guides);
  }
  static async create(editor = false) {
    const base = await VfxRenderer.create();
    try {
      return new StageRenderer(base, editor);
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
  get world() {
    return this.scene;
  }
  get viewCamera() {
    return this.camera;
  }
  getPlane(id: string) {
    return this.meshes.get(id)?.mesh;
  }
  setViewport(width: number, height: number) {
    if (!this.editor) throw Error("Only the scene editor has a viewport size");
    this.viewport = {
      width: Math.max(1, Math.min(2048, Math.round(width))),
      height: Math.max(1, Math.min(2048, Math.round(height))),
    };
    if (this.project) this.configure(this.project.stage ?? stageDefaults());
  }
  setEditorView(view?: Stage) {
    this.editorView = view;
    if (this.project) this.configure(this.project.stage ?? stageDefaults());
  }
  captureView(target: THREE.Vector3): Stage {
    const p = this.camera.position.clone().sub(target),
      distance = p.length(),
      previous = this.project.stage ?? stageDefaults();
    return {
      ...previous,
      projection:
        this.camera instanceof THREE.OrthographicCamera
          ? "orthographic"
          : "perspective",
      azimuth: THREE.MathUtils.radToDeg(Math.atan2(p.x, p.z)),
      elevation: THREE.MathUtils.radToDeg(Math.asin(p.y / distance)),
      distance,
      span:
        this.camera instanceof THREE.OrthographicCamera
          ? (this.camera.top - this.camera.bottom) / this.camera.zoom
          : previous.span,
      fov:
        this.camera instanceof THREE.PerspectiveCamera
          ? this.camera.fov
          : previous.fov,
      target: { x: target.x, y: target.y, z: target.z },
    };
  }
  rememberView(view: Stage) {
    this.editorView = view;
  }
  pick(clientX: number, clientY: number): string | undefined {
    const box = this.canvas.getBoundingClientRect(),
      ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(
        ((clientX - box.left) / box.width) * 2 - 1,
        (-(clientY - box.top) / box.height) * 2 + 1,
      ),
      this.camera,
    );
    for (const hit of ray.intersectObjects(
      [...this.meshes.values()].map((m) => m.mesh),
      false,
    )) {
      const pair = [...this.meshes.entries()].find(
        ([, m]) => m.mesh === hit.object,
      );
      if (!pair || !pair[1].mesh.visible || !hit.uv) continue;
      const image = pair[1].texture.image,
        x = Math.max(
          0,
          Math.min(image.width - 1, Math.floor(hit.uv.x * image.width)),
        ),
        y = Math.max(
          0,
          Math.min(image.height - 1, Math.floor(hit.uv.y * image.height)),
        );
      if ((image.data as Uint8Array)[(y * image.width + x) * 4 + 3] > 8)
        return pair[0];
    }
  }
  bounds(id: string): THREE.Box3 | null {
    const item = this.meshes.get(id);
    if (!item || !item.mesh.visible) return null;
    const { width, height, data } = item.texture.image;
    let left = width,
      right = -1,
      bottom = height,
      top = -1;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if ((data as Uint8Array)[(y * width + x) * 4 + 3] > 8) {
          left = Math.min(left, x);
          right = Math.max(right, x);
          bottom = Math.min(bottom, y);
          top = Math.max(top, y);
        }
    if (right < 0) return new THREE.Box3().setFromObject(item.mesh);
    item.mesh.updateWorldMatrix(true, false);
    return new THREE.Box3().setFromPoints(
      [
        [left, bottom],
        [right + 1, bottom],
        [right + 1, top + 1],
        [left, top + 1],
      ].map(([x, y]) =>
        item.mesh.localToWorld(
          new THREE.Vector3(x - width / 2, y - height / 2, 0),
        ),
      ),
    );
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
    this.effectKey = JSON.stringify(effect);
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

    if (geometryChanged) {
      this.clearPlanes();
      this.textureKey = "";
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
      view = this.editorView ?? stage,
      width = this.viewport?.width ?? p.canvas.width,
      height = this.viewport?.height ?? p.canvas.height,
      aspect = width / height;
    if (this.canvas.width !== width || this.canvas.height !== height)
      this.gpu.setSize(width, height, false);
    if (view.projection === "orthographic") {
      if (!(this.camera instanceof THREE.OrthographicCamera))
        this.camera = new THREE.OrthographicCamera();
      const camera = this.camera as THREE.OrthographicCamera;
      camera.left = (-view.span * aspect) / 2;
      camera.right = (view.span * aspect) / 2;
      camera.top = view.span / 2;
      camera.bottom = -view.span / 2;
      camera.near = 0.1;
      camera.far = 32768;
      camera.zoom = 1;
      camera.updateProjectionMatrix();
    } else {
      if (!(this.camera instanceof THREE.PerspectiveCamera))
        this.camera = new THREE.PerspectiveCamera();
      const camera = this.camera as THREE.PerspectiveCamera;
      camera.fov = view.fov;
      camera.aspect = aspect;
      camera.near = 0.1;
      camera.far = 32768;
      camera.zoom = 1;
      camera.updateProjectionMatrix();
    }
    const azimuth = THREE.MathUtils.degToRad(view.azimuth),
      elevation = THREE.MathUtils.degToRad(view.elevation),
      target = new THREE.Vector3(view.target.x, view.target.y, view.target.z);
    this.camera.position.set(
      target.x + view.distance * Math.sin(azimuth) * Math.cos(elevation),
      target.y + view.distance * Math.sin(elevation),
      target.z + view.distance * Math.cos(azimuth) * Math.cos(elevation),
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
      mesh.scale.set(
        placement.scale * placement.stretch.x,
        placement.scale * placement.stretch.y,
        placement.scale * placement.stretch.z,
      );
      mesh.renderOrder = stage.mode === "3d" ? 0 : index;
      mesh.material.blending =
        l.blend === "add" ? THREE.AdditiveBlending : THREE.NormalBlending;
    }
  }
  render(time: number, ids?: ReadonlySet<string>) {
    if (this.disposed || !this.project) return;
    const p = this.project,
      textureKey = this.effectKey + "|" + time,
      updateTextures = textureKey !== this.textureKey;
    for (const l of p.layers) {
      const { mesh, texture } = this.meshes.get(l.id)!;
      const stage = p.stage ?? stageDefaults(),
        placement = stage.layers[l.id];
      if ((placement?.plane ?? stage.plane) === "billboard") {
        mesh.quaternion.copy(this.camera.quaternion);
        if (placement) {
          mesh.rotateX(THREE.MathUtils.degToRad(placement.rotation.x));
          mesh.rotateY(THREE.MathUtils.degToRad(placement.rotation.y));
          mesh.rotateZ(THREE.MathUtils.degToRad(placement.rotation.z));
        }
      }
      mesh.visible = l.visible && (!ids || ids.has(l.id));
      if (!l.visible || !updateTextures) continue;
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
    this.textureKey = textureKey;
    this.gpu.render(this.scene, this.camera);
  }
  pixels(): Uint8ClampedArray {
    const { width, height } = this.canvas,
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
