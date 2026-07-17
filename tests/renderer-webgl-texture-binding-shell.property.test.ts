import { describe, expect, it } from "vitest";
import {
  TEXTURE_BINDING_ACTIVATE_UNIT,
  TEXTURE_BINDING_BIND_TARGET,
  textureBindingOperations,
} from "../packages/renderer-webgl/src/webgl/texture-binding-shell";

describe("WebGL texture binding transition policy", () => {
  it("independently plans active-unit and target-binding mutations", () => {
    const first = {} as WebGLTexture;
    const second = {} as WebGLTexture;

    expect(textureBindingOperations(undefined, undefined, 3, first)).toBe(
      TEXTURE_BINDING_ACTIVATE_UNIT | TEXTURE_BINDING_BIND_TARGET,
    );
    expect(textureBindingOperations(3, first, 3, first)).toBe(0);
    expect(textureBindingOperations(2, first, 3, first)).toBe(0);
    expect(textureBindingOperations(3, first, 3, second)).toBe(TEXTURE_BINDING_BIND_TARGET);
  });
});
