import type { CanonicalDirectionalLight, CanonicalPunctualLight } from './scene-lowering';
import type { PersistentGpuBudgetOwner } from '../resource/persistent-gpu-budget';

/** One root-owned RGBA32F light table, loaded on demand. */
export class LargeLightRuntime {
  readonly #gl: WebGL2RenderingContext;
  readonly #budget: PersistentGpuBudgetOwner;
  readonly #limit: number;
  #allocation: { texture: WebGLTexture; capacity: number; claim: object } | undefined;
  #staging = new Float32Array(0);
  #directionalCount = 0;
  #punctualCount = 0;
  #disposed = false;

  constructor(gl: WebGL2RenderingContext, budget: PersistentGpuBudgetOwner) {
    this.#gl = gl;
    this.#budget = budget;
    this.#limit = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (!Number.isSafeInteger(this.#limit) || this.#limit < 256) {
      throw new Error('Large-light texture capacity is below 256 records');
    }
  }

  get texture(): WebGLTexture | undefined { return this.#allocation?.texture; }
  get byteLength(): number { return (this.#allocation?.capacity ?? 0) * 64; }
  get counts(): readonly [number, number] { return [this.#directionalCount, this.#punctualCount]; }
  get limit(): number { return this.#limit; }

  /** Caller invalidates texture-unit state after upload. Never silently truncates. */
  set(directional: readonly CanonicalDirectionalLight[], punctual: readonly CanonicalPunctualLight[]): void {
    if (this.#disposed) throw new Error('Large-light runtime is disposed');
    const count = directional.length + punctual.length;
    if (!Number.isSafeInteger(count) || count > this.#limit) {
      throw new RangeError(`Large-light scene has ${count} lights; device texture limit is ${this.#limit}`);
    }
    if (count === 0) { this.clear(); return; }
    const capacity = Math.min(this.#limit, Math.max(256, 2 ** Math.ceil(Math.log2(count))));
    if (this.#staging.length < capacity * 16) this.#staging = new Float32Array(capacity * 16);
    this.#staging.fill(0, 0, count * 16);
    for (let index = 0; index < directional.length; index++) {
      const light = directional[index]!;
      this.#staging.set(light.color, index * 16);
      this.#staging.set(light.direction, index * 16 + 4);
    }
    for (let index = 0; index < punctual.length; index++) {
      const light = punctual[index]!;
      const offset = (directional.length + index) * 16;
      this.#staging.set(light.color, offset);
      this.#staging.set(light.direction, offset + 4);
      this.#staging[offset + 7] = light.kind === 'spot' ? 1 : 0;
      this.#staging.set(light.position, offset + 8);
      this.#staging[offset + 11] = light.range;
      this.#staging[offset + 12] = light.innerConeCosine;
      this.#staging[offset + 13] = light.outerConeCosine;
    }
    const gl = this.#gl;
    gl.activeTexture(gl.TEXTURE13);
    const previous = this.#allocation;
    let next = previous;
    try {
      if (previous === undefined || previous.capacity < capacity) {
        const claim = {};
        // Reserve simultaneous old/new storage before creating the replacement.
        if (!this.#budget.tryClaim(claim, capacity * 64)) throw new Error('Large-light GPU budget exhausted');
        const texture = gl.createTexture();
        if (texture === null) { this.#budget.release(claim); throw new Error('Large-light texture allocation failed'); }
        next = { texture, capacity, claim };
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 4, capacity);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      } else gl.bindTexture(gl.TEXTURE_2D, previous.texture);
      if (next !== previous) {
        const error = gl.getError();
        if (error !== gl.NO_ERROR) throw new Error(`Large-light allocation failed with GL error ${error}`);
      }
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, count, gl.RGBA, gl.FLOAT, this.#staging.subarray(0, count * 16));
      // WebGL reports upload failures through its error flag, not exceptions.
      const uploadError = gl.getError();
      if (uploadError !== gl.NO_ERROR) throw new Error(`Large-light upload failed with GL error ${uploadError}`);
      if (next !== previous && previous !== undefined) {
        gl.deleteTexture(previous.texture);
        this.#budget.release(previous.claim);
      }
      this.#allocation = next;
      this.#directionalCount = directional.length;
      this.#punctualCount = punctual.length;
    } catch (error) {
      if (next !== previous && next !== undefined) {
        gl.deleteTexture(next.texture);
        this.#budget.release(next.claim);
      }
      throw error;
    }
  }

  clear(): void {
    if (this.#allocation !== undefined) {
      this.#gl.deleteTexture(this.#allocation.texture);
      this.#budget.release(this.#allocation.claim);
      this.#allocation = undefined;
    }
    this.#directionalCount = this.#punctualCount = 0;
    this.#staging = new Float32Array(0);
  }

  /** Context loss invalidates the texture; restoring uses the canonical scene. */
  invalidate(): void { this.clear(); }
  dispose(): void { this.clear(); this.#disposed = true; }
}

/** Reuses the production loops and BRDF; only count bounds and transport change. */
export const largeLightShader = (source: string): string => {
  const declarations = `uniform highp sampler2D largeLightData;
uniform ivec2 largeLightCounts;
vec4 directionalRecord(int index, int field) { return texelFetch(largeLightData, ivec2(field,index), 0); }
vec4 punctualRecord(int index, int field) { return texelFetch(largeLightData, ivec2(field,index+largeLightCounts.x), 0); }`;
  let result = source.replace(/uniform vec4 directionalLightColors\[MAX_DIRECTIONAL_LIGHTS\];\s*uniform vec4 directionalLightDirections\[MAX_DIRECTIONAL_LIGHTS\];/, declarations)
    .replace(/uniform vec4 punctualLightColors\[MAX_PUNCTUAL_LIGHTS\];\s*uniform vec4 punctualLightDirections\[MAX_PUNCTUAL_LIGHTS\];\s*uniform vec4 punctualLightPositions\[MAX_PUNCTUAL_LIGHTS\];\s*uniform vec4 punctualLightSpotCones\[MAX_PUNCTUAL_LIGHTS\];/, '')
    .replace(/\bindex\s*<\s*MAX_DIRECTIONAL_LIGHTS/, 'index < largeLightCounts.x')
    .replace(/\bindex\s*<\s*MAX_PUNCTUAL_LIGHTS/, 'index < largeLightCounts.y');
  for (const [name, lookup] of [
    ['directionalLightColors', 'directionalRecord(index,0)'],
    ['directionalLightDirections', 'directionalRecord(index,1)'],
    ['punctualLightColors', 'punctualRecord(index,0)'],
    ['punctualLightDirections', 'punctualRecord(index,1)'],
    ['punctualLightPositions', 'punctualRecord(index,2)'],
    ['punctualLightSpotCones', 'punctualRecord(index,3)'],
  ]) result = result.replaceAll(`${name}[index]`, lookup!);
  if (!result.includes(declarations)
    || !result.includes('index < largeLightCounts.x')
    || !result.includes('index < largeLightCounts.y')
    || /(?:directional|punctual)Light(?:Colors|Directions|Positions|SpotCones)\[/.test(result)) throw new Error('Large-light shader replacement failed');
  return result.replace('#version 300 es', '#version 300 es\n#define LARGE_LIGHT_ZERO_REJECTION');
};
