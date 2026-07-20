import { PersistentGpuBudgetOwner } from "../resource/persistent-gpu-budget";
import type { TextureUnitBinding } from "../webgl/draw-state-transition";
import type { PreparedRoyalEnvironment } from "./royal-environment-ktx1";

export type PrefilteredEnvironmentGpuBinding = Readonly<{
  coefficients: Float32Array;
  mipCount: number;
  texture: TextureUnitBinding;
}>;

type EnvironmentGpuResource = Readonly<{
  binding: PrefilteredEnvironmentGpuBinding;
  budgetIdentity: object;
  sampler: WebGLSampler;
  texture: WebGLTexture;
}>;

const gpuBytes = (prepared: PreparedRoyalEnvironment): number => prepared.levels.reduce(
  (total, level) => total + level.faces.reduce(
    (levelTotal, face) => levelTotal + face.byteLength,
    0,
  ),
  0,
);

const coefficients = (prepared: PreparedRoyalEnvironment): Float32Array => {
  const values = new Float32Array(9 * 4);
  for (let index = 0; index < prepared.metadata.sh.length; index += 1) {
    values.set(prepared.metadata.sh[index]!, index * 4);
  }
  return values;
};

/** Owns the single active prefiltered cubemap in one WebGL context generation. */
export class PrefilteredEnvironmentGpuOwner {
  readonly #budget: PersistentGpuBudgetOwner;
  readonly #gl: WebGL2RenderingContext;
  #prepared: PreparedRoyalEnvironment | undefined;
  #resource: EnvironmentGpuResource | undefined;

  constructor(gl: WebGL2RenderingContext, budget: PersistentGpuBudgetOwner) {
    this.#budget = budget;
    this.#gl = gl;
  }

  get binding(): PrefilteredEnvironmentGpuBinding | undefined {
    return this.#resource?.binding;
  }

  dispose(): void {
    this.#prepared = undefined;
    const resource = this.#resource;
    if (resource === undefined) return;
    this.#resource = undefined;
    this.#gl.deleteSampler(resource.sampler);
    this.#gl.deleteTexture(resource.texture);
    this.#budget.release(resource.budgetIdentity);
  }

  invalidate(): void {
    this.#prepared = undefined;
    const resource = this.#resource;
    if (resource === undefined) return;
    this.#resource = undefined;
    this.#budget.release(resource.budgetIdentity);
  }

  set(prepared: PreparedRoyalEnvironment | undefined): boolean {
    if (this.#prepared === prepared) return false;
    this.dispose();
    this.#prepared = prepared;
    if (prepared === undefined) return true;
    const budgetIdentity = {};
    if (!this.#budget.tryClaim(budgetIdentity, gpuBytes(prepared))) return true;
    let texture: WebGLTexture | null = null;
    let sampler: WebGLSampler | null = null;
    try {
      const gl = this.#gl;
      texture = gl.createTexture();
      sampler = gl.createSampler();
      if (texture === null || sampler === null) {
        throw new Error("Royal could not allocate a prefiltered environment");
      }
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
      gl.texStorage2D(
        gl.TEXTURE_CUBE_MAP,
        prepared.levels.length,
        gl.R11F_G11F_B10F,
        prepared.size,
        prepared.size,
      );
      for (const level of prepared.levels) {
        for (const face of level.faces) {
          gl.texSubImage2D(
            gl.TEXTURE_CUBE_MAP_POSITIVE_X + face.face,
            level.level,
            0,
            0,
            level.size,
            level.size,
            gl.RGB,
            gl.UNSIGNED_INT_10F_11F_11F_REV,
            new Uint32Array(prepared.source, face.byteOffset, face.byteLength / 4),
          );
        }
      }
      gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
      const binding: PrefilteredEnvironmentGpuBinding = {
        coefficients: coefficients(prepared),
        mipCount: prepared.levels.length,
        texture: { sampler, target: "cube", texture },
      };
      this.#resource = { binding, budgetIdentity, sampler, texture };
      return true;
    } catch (error) {
      if (sampler !== null) this.#gl.deleteSampler(sampler);
      if (texture !== null) this.#gl.deleteTexture(texture);
      this.#budget.release(budgetIdentity);
      throw error;
    }
  }
}
