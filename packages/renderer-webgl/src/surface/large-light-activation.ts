import { MAX_UNIFORM_DIRECTIONAL_LIGHTS, MAX_UNIFORM_PUNCTUAL_LIGHTS } from './surface-program-features';
import type { FrameUploadBudgetOwner } from "../resource/frame-upload-budget";
import type { CanonicalDirectionalLight, CanonicalPunctualLight } from './scene-lowering';
import type { PersistentGpuBudgetOwner } from '../resource/persistent-gpu-budget';
import type { LargeLightRuntime } from './large-light-runtime';

type LightSet = Readonly<{
  directionalLights: readonly CanonicalDirectionalLight[];
  punctualLights: readonly CanonicalPunctualLight[];
}>;
type Module = typeof import('./large-light-runtime');

/** Root-owned activation for the optional large-light path. */
export class LargeLightActivation {
  readonly #gl: WebGL2RenderingContext;
  readonly #budget: PersistentGpuBudgetOwner;
  readonly #changed: () => void;
  readonly #load: () => Promise<Module>;
  #generation = 0;
  #disposed = false;
  #scene: LightSet | undefined;
  #module: Module | undefined;
  #runtime: LargeLightRuntime | undefined;
  #pending = false;
  #uploadPending = false;
  #failure: unknown;

  constructor(gl: WebGL2RenderingContext, budget: PersistentGpuBudgetOwner, changed: () => void,
    load: () => Promise<Module> = () => import('./large-light-runtime')) {
    this.#gl = gl; this.#budget = budget; this.#changed = changed; this.#load = load;
  }

  get pending(): boolean { return this.#pending || this.#uploadPending; }
  get runtime(): LargeLightRuntime | undefined { return this.#runtime; }
  get failure(): unknown { return this.#failure; }

  /** Cold texture-fitting reservation, including simultaneous replacement storage. */
  get plannedByteLength(): number {
    if (this.#scene === undefined) return 0;
    const count = this.#scene.directionalLights.length + this.#scene.punctualLights.length;
    const next = Math.max(256, 2 ** Math.ceil(Math.log2(count))) * 64;
    const current = this.#runtime?.byteLength ?? 0;
    return current >= next ? current : current + next;
  }

  shader(source: string): string {
    if (this.#module === undefined) throw new Error('Large-light module is not ready');
    return this.#module.largeLightShader(source);
  }

  set(scene: LightSet): void {
    if (this.#disposed) throw new Error('Large-light activation is disposed');
    if (scene.directionalLights.length <= MAX_UNIFORM_DIRECTIONAL_LIGHTS
      && scene.punctualLights.length <= MAX_UNIFORM_PUNCTUAL_LIGHTS) {
      this.#scene = undefined;
      this.#generation++;
      this.#pending = false;
      this.#uploadPending = false;
      this.#failure = undefined;
      this.#runtime?.dispose();
      this.#runtime = undefined;
      return;
    }
    this.#scene = scene;
    this.#failure = undefined;
    this.#uploadPending = true;
    if (this.#module !== undefined) return;
    if (this.#pending) return;
    this.#pending = true;
    const generation = ++this.#generation;
    void this.#load().then(module => {
      if (this.#disposed || generation !== this.#generation) return;
      this.#pending = false;
      this.#module = module;
      this.#changed();
    }).catch((error: unknown) => {
      if (this.#disposed || generation !== this.#generation) return;
      this.#pending = false;
      this.#failure = error;
      this.#uploadPending = false;
      this.#changed();
    });
  }

  /** GPU work is admitted by the caller's frame, never by the import callback. */
  prepare(uploadBudget?: FrameUploadBudgetOwner): boolean {
    if (this.#disposed) throw new Error('Large-light activation is disposed');
    if (this.#failure !== undefined) throw this.#failure;
    if (this.#pending) return false;
    if (!this.#uploadPending) return true;
    const scene = this.#scene!;
    const bytes = (scene.directionalLights.length + scene.punctualLights.length) * 64;
    if (uploadBudget !== undefined && !uploadBudget.tryAdmit(bytes)) return false;
    try {
      this.#install();
      this.#uploadPending = false;
      return true;
    } catch (error) {
      this.#failure = error;
      this.#uploadPending = false;
      throw error;
    }
  }

  #install(): void {
    const scene = this.#scene;
    if (scene === undefined || this.#module === undefined) return;
    const previous = this.#runtime;
    const runtime = previous ?? new this.#module.LargeLightRuntime(this.#gl, this.#budget);
    try {
      runtime.set(scene.directionalLights, scene.punctualLights);
      this.#runtime = runtime;
    } catch (error) {
      if (previous === undefined) runtime.dispose();
      throw error;
    }
  }

  invalidate(): void {
    this.#generation++;
    this.#pending = false;
    this.#uploadPending = false;
    this.#failure = undefined;
    this.#runtime?.dispose();
    this.#runtime = undefined;
    this.#scene = undefined;
  }

  dispose(): void { this.invalidate(); this.#disposed = true; }
}
