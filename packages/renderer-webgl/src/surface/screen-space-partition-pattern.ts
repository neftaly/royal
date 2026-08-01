import { PersistentGpuBudgetOwner } from "../resource/persistent-gpu-budget";
import type { TextureUnitBinding } from "../webgl/draw-state-transition";

export const SCREEN_SPACE_PARTITION_PATTERN_SIZE = 64;
export const SCREEN_SPACE_PARTITION_BUCKET_BITS = 12;
export const SCREEN_SPACE_PARTITION_SURFACE_TEXTURE_UNIT = 12;
export const SCREEN_SPACE_PARTITION_PATTERN_BYTES =
  SCREEN_SPACE_PARTITION_PATTERN_SIZE * SCREEN_SPACE_PARTITION_PATTERN_SIZE * 2;
const SCREEN_SPACE_PARTITION_PATTERN_CELLS =
  SCREEN_SPACE_PARTITION_PATTERN_SIZE * SCREEN_SPACE_PARTITION_PATTERN_SIZE;

const buildScreenSpacePartitionPattern = (): Uint16Array => {
  const pattern = Uint16Array.from(
    { length: SCREEN_SPACE_PARTITION_PATTERN_CELLS },
    (_, index) => index,
  );
  let state = 0x9e37_79b9;
  for (let index = pattern.length - 1; index > 0; index -= 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const other = state % (index + 1);
    const value = pattern[index]!;
    pattern[index] = pattern[other]!;
    pattern[other] = value;
  }
  return pattern;
};

const SCREEN_SPACE_PARTITION_PATTERN = buildScreenSpacePartitionPattern();

/** Creates the one deterministic R16UI tile shared by every partition count. */
export const createScreenSpacePartitionPattern = (): Uint16Array =>
  SCREEN_SPACE_PARTITION_PATTERN.slice();

/** CPU reference used to verify orientation balance and exact partitioning. */
export const screenSpacePartitionCellIndex = (
  cellX: number,
  cellY: number,
  count: number,
): number => {
  const mask = SCREEN_SPACE_PARTITION_PATTERN_SIZE - 1;
  const bucket = SCREEN_SPACE_PARTITION_PATTERN[
    (cellY & mask) * SCREEN_SPACE_PARTITION_PATTERN_SIZE + (cellX & mask)
  ]!;
  return (bucket * count) >>> SCREEN_SPACE_PARTITION_BUCKET_BITS;
};

/** Root-shared, lazily allocated GPU pattern used by every admitted material. */
export class ScreenSpacePartitionPatternOwner {
  readonly #budget: PersistentGpuBudgetOwner;
  readonly #claim = {};
  readonly #gl: WebGL2RenderingContext;
  #binding: TextureUnitBinding | null = null;

  constructor(
    gl: WebGL2RenderingContext,
    budget = new PersistentGpuBudgetOwner(),
  ) {
    this.#budget = budget;
    this.#gl = gl;
  }

  get binding(): TextureUnitBinding {
    if (this.#binding === null) {
      throw new Error("Royal screen-space partition pattern is not allocated");
    }
    return this.#binding;
  }

  /** Ensures the shared binding exists; reports whether WebGL state changed. */
  ensure(): boolean {
    if (this.#binding !== null) return false;
    const gl = this.#gl;
    if (!this.#budget.tryClaim(this.#claim, SCREEN_SPACE_PARTITION_PATTERN_BYTES)) {
      throw new Error("Royal persistent GPU budget denied the screen-space partition pattern");
    }
    const texture = gl.createTexture();
    const sampler = gl.createSampler();
    try {
      if (texture === null || sampler === null) {
        throw new Error("Royal could not allocate the screen-space partition pattern");
      }
      gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(
        gl.TEXTURE_2D,
        1,
        gl.R16UI,
        SCREEN_SPACE_PARTITION_PATTERN_SIZE,
        SCREEN_SPACE_PARTITION_PATTERN_SIZE,
      );
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        SCREEN_SPACE_PARTITION_PATTERN_SIZE,
        SCREEN_SPACE_PARTITION_PATTERN_SIZE,
        gl.RED_INTEGER,
        gl.UNSIGNED_SHORT,
        createScreenSpacePartitionPattern(),
      );
      this.#binding = { sampler, target: "2d", texture };
      return true;
    } catch (error) {
      if (texture !== null) gl.deleteTexture(texture);
      if (sampler !== null) gl.deleteSampler(sampler);
      this.#budget.release(this.#claim);
      throw error;
    }
  }

  dispose(): void {
    const binding = this.#binding;
    if (binding !== null) {
      if (binding.texture !== null) this.#gl.deleteTexture(binding.texture);
      if (binding.sampler !== null) this.#gl.deleteSampler(binding.sampler);
    }
    this.#binding = null;
    this.#budget.release(this.#claim);
  }

  /** Drops context-invalid handles without issuing delete calls. */
  abandon(): void {
    this.#binding = null;
    this.#budget.release(this.#claim);
  }
}
