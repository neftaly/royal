export const TEXTURE_BINDING_ACTIVATE_UNIT = 1;
export const TEXTURE_BINDING_BIND_TARGET = 2;

/** Pure transition policy for retained WebGL texture bindings. */
export const textureBindingOperations = (
  activeUnit: number | undefined,
  boundTexture: WebGLTexture | null | undefined,
  unit: number,
  texture: WebGLTexture | null,
): number => boundTexture === texture
  ? 0
  : TEXTURE_BINDING_BIND_TARGET
    | (activeUnit === unit ? 0 : TEXTURE_BINDING_ACTIVATE_UNIT);

/** Imperative shell retaining texture-unit state only within one Royal-owned pass. */
export class WebGlTextureBindingShell {
  readonly #boundCube: Array<WebGLTexture | null | undefined> = [];
  readonly #boundTexture2d: Array<WebGLTexture | null | undefined> = [];
  readonly #gl: WebGL2RenderingContext;
  #activeUnit: number | undefined;

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
  }

  bindCube(unit: number, texture: WebGLTexture | null): void {
    this.#bind(this.#boundCube, unit, this.#gl.TEXTURE_CUBE_MAP, texture);
  }

  bindTexture2d(unit: number, texture: WebGLTexture | null): void {
    this.#bind(this.#boundTexture2d, unit, this.#gl.TEXTURE_2D, texture);
  }

  /** Forgets retained state after any raw binding mutation or external ownership boundary. */
  invalidate(): void {
    this.#activeUnit = undefined;
    this.#boundCube.length = 0;
    this.#boundTexture2d.length = 0;
  }

  #bind(
    bindings: Array<WebGLTexture | null | undefined>,
    unit: number,
    target: number,
    texture: WebGLTexture | null,
  ): void {
    const operations = textureBindingOperations(this.#activeUnit, bindings[unit], unit, texture);
    if ((operations & TEXTURE_BINDING_ACTIVATE_UNIT) !== 0) {
      this.#gl.activeTexture(this.#gl.TEXTURE0 + unit);
      this.#activeUnit = unit;
    }
    if ((operations & TEXTURE_BINDING_BIND_TARGET) !== 0) {
      this.#gl.bindTexture(target, texture);
      bindings[unit] = texture;
    }
  }
}
