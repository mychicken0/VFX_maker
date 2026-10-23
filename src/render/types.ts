import type { Project } from "../core/model.js";
export interface EffectRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly view?: "effect" | "stage";
  setProject(project: Project): Promise<void>;
  render(time: number, ids?: ReadonlySet<string>): void;
  pixels(): Uint8ClampedArray;
  destroy(): void;
}
