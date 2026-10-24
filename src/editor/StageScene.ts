import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { StageRenderer } from "../render/stage.js";
import { applyEdits } from "../core/operations.js";
import {
  stageDefaults,
  stagePlacementSchema,
  stageSchema,
  type Stage,
} from "../core/stage.js";
import type { Project } from "../core/model.js";
import { clamp } from "../core/math.js";
import { readableError } from "../core/errors.js";
export type StageTool = "translate" | "rotate" | "scale" | "orbit";
type Events = {
  select: (id: string) => void;
  draft: (p: Project | null) => void;
  commit: (p: Project) => void;
  view: (view: Stage) => void;
  interact: () => void;
  error: (message: string) => void;
};
/** Editing camera and helpers are ephemeral. Only explicit transforms/camera alignment write a project. */
export class StageScene {
  readonly orbit: OrbitControls;
  readonly transform: TransformControls;
  private readonly proxy = new THREE.Object3D();
  private readonly outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
    new THREE.LineBasicMaterial({
      color: 0xbca6ff,
      depthTest: false,
      transparent: true,
      opacity: 0.8,
    }),
  );
  private source!: Project;
  private selected = "";
  private time = 0;
  private active = false;
  private view?: Stage;
  private drag?: { source: Project; last: Project | null };
  private tool: StageTool = "translate";
  private skipPick = false;
  private pointer?: { x: number; y: number; button: number };
  private disposed = false;
  private cleanups: (() => void)[] = [];
  private constructor(
    readonly renderer: StageRenderer,
    private readonly events: Events,
  ) {
    const canvas = renderer.canvas;
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "3D scene canvas");
    this.orbit = new OrbitControls(renderer.viewCamera, canvas);
    this.orbit.enableDamping = false;
    this.orbit.minPolarAngle = THREE.MathUtils.degToRad(1);
    this.orbit.maxPolarAngle = THREE.MathUtils.degToRad(175);
    this.orbit.minDistance = 16;
    this.orbit.maxDistance = 8192;
    this.orbit.minZoom = 0.05;
    this.orbit.maxZoom = 32;
    this.orbit.mouseButtons = {
      LEFT: undefined,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.transform = new TransformControls(renderer.viewCamera, canvas);
    this.transform.setSize(0.9);
    this.transform.setSpace("world");
    renderer.world.add(this.proxy, this.transform.getHelper());
    this.outline.renderOrder = 10000;
    this.orbit.addEventListener("start", () => events.interact());
    this.orbit.addEventListener("change", () => {
      if (!this.active || this.disposed || this.transform.dragging) return;
      const bounded = this.orbit.target.clone();
      bounded.set(
        clamp(bounded.x, -4096, 4096),
        clamp(bounded.y, -4096, 4096),
        clamp(bounded.z, -4096, 4096),
      );
      const correction = bounded.clone().sub(this.orbit.target);
      this.orbit.object.position.add(correction);
      this.orbit.target.copy(bounded);
      this.view = renderer.captureView(this.orbit.target);
      renderer.rememberView(this.view);
      this.render();
    });
    this.orbit.addEventListener("end", () => {
      if (this.view) events.view(this.view);
      this.attach();
      this.render();
    });
    this.transform.addEventListener("mouseDown", () => {
      if (!this.source || !this.selected) return;
      this.drag = { source: this.source, last: null };
      this.skipPick = true;
      this.orbit.enabled = false;
      events.interact();
    });
    this.transform.addEventListener("objectChange", () =>
      this.transformDraft(),
    );
    this.transform.addEventListener("change", () => {
      if (!this.disposed) this.render();
    });
    this.transform.addEventListener("mouseUp", () => {
      const result = this.drag?.last;
      this.drag = undefined;
      this.orbit.enabled = this.active;
      if (result) events.commit(result);
      events.draft(null);
      queueMicrotask(() => {
        this.skipPick = false;
      });
    });
    const down = (event: PointerEvent) => {
      canvas.focus({ preventScroll: true });
      this.pointer = {
        x: event.clientX,
        y: event.clientY,
        button: event.button,
      };
      this.orbit.mouseButtons.MIDDLE = event.shiftKey
        ? THREE.MOUSE.PAN
        : THREE.MOUSE.ROTATE;
      this.orbit.mouseButtons.LEFT =
        this.tool === "orbit" || event.altKey ? THREE.MOUSE.ROTATE : undefined;
      if (event.shiftKey) {
        this.transform.setTranslationSnap(1);
        this.transform.setRotationSnap(THREE.MathUtils.degToRad(15));
        this.transform.setScaleSnap(0.1);
      } else {
        this.transform.setTranslationSnap(null);
        this.transform.setRotationSnap(null);
        this.transform.setScaleSnap(null);
      }
    };
    const up = (event: PointerEvent) => {
      if (
        !this.active ||
        this.skipPick ||
        this.tool === "orbit" ||
        event.altKey ||
        this.pointer?.button !== 0
      )
        return;
      if (
        Math.hypot(
          event.clientX - this.pointer.x,
          event.clientY - this.pointer.y,
        ) > 4
      )
        return;
      const hit = renderer.pick(event.clientX, event.clientY);
      if (hit) events.select(hit);
    };
    const cancel = () => this.cancel();
    canvas.addEventListener("pointerdown", down, true);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", cancel);
    this.cleanups.push(() => {
      canvas.removeEventListener("pointerdown", down, true);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", cancel);
    });
  }
  static async create(events: Events) {
    return new StageScene(await StageRenderer.create(true), events);
  }
  get canvas() {
    return this.renderer.canvas;
  }
  get dragging() {
    return !!this.drag;
  }
  async setProject(p: Project, isDraft = false) {
    if (!isDraft) this.source = p;
    if (!this.view) this.view = structuredClone(p.stage ?? stageDefaults());
    this.renderer.setEditorView(this.view);
    await this.renderer.setProject(p);
    if (this.disposed) return;
    this.refreshCamera();
    if (!this.drag) this.attach();
    this.render();
  }
  private refreshCamera() {
    this.orbit.object = this.renderer.viewCamera;
    this.transform.camera = this.renderer.viewCamera;
    if (this.renderer.viewCamera instanceof THREE.OrthographicCamera) {
      const span =
        this.renderer.viewCamera.top - this.renderer.viewCamera.bottom;
      this.orbit.minZoom = span / 4096;
      this.orbit.maxZoom = span / 16;
    }
    const target = this.view?.target ?? { x: 0, y: 0, z: 0 };
    this.orbit.target.set(target.x, target.y, target.z);
  }
  setViewport(width: number, height: number) {
    this.renderer.setViewport(width, height);
    this.refreshCamera();
    this.render();
  }
  setTime(time: number) {
    this.time = time;
    this.render();
  }
  setActive(active: boolean) {
    this.active = active;
    this.orbit.enabled = active;
    this.attach();
    this.render();
  }
  setGuides(visible: boolean) {
    this.renderer.setGuides(visible);
    this.render();
  }
  setTool(tool: StageTool) {
    this.tool = tool;
    if (tool !== "orbit") this.transform.setMode(tool);
    this.transform.enabled = tool !== "orbit" && this.active;
    this.attach();
    this.render();
  }
  select(id: string) {
    this.selected = id;
    this.attach();
    this.render();
  }
  private attach() {
    this.outline.removeFromParent();
    const mesh = this.renderer.getPlane(this.selected),
      layer = this.source?.layers.find((l) => l.id === this.selected);
    if (!mesh || !layer?.visible || !this.active) {
      this.transform.detach();
      return;
    }
    const width = this.source.canvas.width,
      height = this.source.canvas.height;
    this.outline.scale.set(width, height, 1);
    mesh.add(this.outline);
    this.proxy.position.copy(mesh.position);
    this.proxy.quaternion.copy(mesh.quaternion);
    this.proxy.scale.copy(mesh.scale);
    this.proxy.updateMatrixWorld(true);
    if (layer.locked || this.tool === "orbit") this.transform.detach();
    else this.transform.attach(this.proxy);
  }
  private transformDraft() {
    if (!this.drag || !this.selected) return;
    const p = this.drag.source,
      stage = p.stage ?? stageDefaults(),
      index = p.layers.findIndex((l) => l.id === this.selected),
      placement =
        stage.layers[this.selected] ??
        stagePlacementSchema.parse({ plane: stage.plane });
    const base = new THREE.Quaternion();
    if (placement.plane === "ground")
      base.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    else if (placement.plane === "billboard")
      base.copy(this.renderer.viewCamera.quaternion);
    const rotation = new THREE.Euler().setFromQuaternion(
      base.invert().multiply(this.proxy.quaternion),
      "XYZ",
    );
    const patch = {
      position: {
        x: clamp(this.proxy.position.x, -4096, 4096),
        y: clamp(
          this.proxy.position.y -
            (placement.plane === "ground" ? index * 0.02 : 0),
          -4096,
          4096,
        ),
        z: clamp(
          this.proxy.position.z -
            (placement.plane === "ground" ? 0 : index * 0.02),
          -4096,
          4096,
        ),
      },
      rotation: {
        x: THREE.MathUtils.radToDeg(rotation.x),
        y: THREE.MathUtils.radToDeg(rotation.y),
        z: THREE.MathUtils.radToDeg(rotation.z),
      },
      stretch: {
        x: clamp(this.proxy.scale.x / placement.scale, 0.01, 16),
        y: clamp(this.proxy.scale.y / placement.scale, 0.01, 16),
        z: clamp(this.proxy.scale.z / placement.scale, 0.01, 16),
      },
    };
    try {
      const draft = applyEdits(p, [
        { action: "place_stage_layer", id: this.selected, patch },
      ]);
      this.drag.last = draft;
      this.events.draft(draft);
    } catch (error) {
      this.events.error(readableError(error));
    }
  }
  cancel() {
    if (!this.drag) return false;
    const original = this.drag.source;
    this.drag = undefined;
    this.transform.reset();
    this.transform.dragging = false;
    this.orbit.enabled = this.active;
    this.events.draft(null);
    void this.setProject(original);
    return true;
  }
  setView(view: Stage) {
    this.view = view;
    this.renderer.setEditorView(view);
    this.refreshCamera();
    this.orbit.update();
    this.events.view(view);
    this.render();
  }
  currentView() {
    return stageSchema.parse(this.renderer.captureView(this.orbit.target));
  }
  preset(name: "front" | "right" | "top" | "isometric" | "projection") {
    const view = this.currentView();
    this.setView({
      ...view,
      ...(name === "front"
        ? { azimuth: 0, elevation: 0 }
        : name === "right"
          ? { azimuth: 90, elevation: 0 }
          : name === "top"
            ? { azimuth: 0, elevation: 89 }
            : name === "isometric"
              ? {
                  azimuth: 45,
                  elevation: 35.264,
                  projection: "orthographic" as const,
                }
              : {
                  projection:
                    view.projection === "orthographic"
                      ? ("perspective" as const)
                      : ("orthographic" as const),
                }),
    });
  }
  frame(all = false) {
    const ids = all
        ? this.source.layers.filter((l) => l.visible).map((l) => l.id)
        : [this.selected],
      box = new THREE.Box3();
    this.renderer.world.updateMatrixWorld(true);
    for (const id of ids) {
      const mesh = this.renderer.getPlane(id);
      if (mesh?.visible) {
        const bounds = this.renderer.bounds(id);
        if (bounds) box.union(bounds);
      }
    }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3()),
      size = box.getSize(new THREE.Vector3()),
      view = this.currentView(),
      aspect = this.canvas.width / this.canvas.height;
    const extent = Math.max(size.y, size.x / aspect, size.z, 16);
    this.setView({
      ...view,
      target: {
        x: clamp(center.x, -4096, 4096),
        y: clamp(center.y, -4096, 4096),
        z: clamp(center.z, -4096, 4096),
      },
      span: clamp(extent * 1.5, 16, 4096),
      distance: clamp(
        (extent / (2 * Math.tan(THREE.MathUtils.degToRad(view.fov / 2)))) * 1.5,
        16,
        8192,
      ),
    });
  }
  render() {
    if (this.disposed) return;
    this.renderer.render(this.time);
  }
  destroy() {
    this.disposed = true;
    for (const cleanup of this.cleanups) cleanup();
    this.orbit.dispose();
    this.transform.dispose();
    this.proxy.removeFromParent();
    this.outline.removeFromParent();
    this.outline.geometry.dispose();
    (this.outline.material as THREE.Material).dispose();
    this.renderer.destroy();
  }
}
