import { describe, expect, it, vi } from "vitest";
import {
  IDENTITY_TEXTURE_COORDINATES,
  prepareTextureCoordinates,
  transformTextureCoordinates,
} from "../../packages/renderer-webgl/src/gltf/texture-coordinates";
import { applyTextureCoordinates } from "../../packages/renderer-webgl/src/surface/surface-gpu-owner";

describe("glTF texture coordinate preparation", () => {
  it("uploads only semantic row changes within one program", () => {
    const uniform4fv = vi.fn();
    const gl = { uniform4fv } as unknown as WebGL2RenderingContext;
    const program = {
      row0: {} as WebGLUniformLocation,
      row1: {} as WebGLUniformLocation,
    };
    let previous = applyTextureCoordinates(gl, program, undefined, undefined);
    expect(previous).toBe(IDENTITY_TEXTURE_COORDINATES);
    expect(uniform4fv).toHaveBeenCalledTimes(2);
    previous = applyTextureCoordinates(gl, program, undefined, previous);
    expect(uniform4fv).toHaveBeenCalledTimes(2);
    const transformed = prepareTextureCoordinates({
      extensions: { KHR_texture_transform: { offset: [0.25, 0.5] } },
    }, "asset", "texture");
    previous = applyTextureCoordinates(gl, program, transformed, previous);
    expect(uniform4fv).toHaveBeenCalledTimes(4);
    applyTextureCoordinates(gl, program, undefined, previous);
    expect(uniform4fv).toHaveBeenCalledTimes(6);
  });

  it("retains one shared identity and selects the second authored UV stream", () => {
    expect(prepareTextureCoordinates({}, "asset", "texture")).toBe(
      IDENTITY_TEXTURE_COORDINATES,
    );
    expect(prepareTextureCoordinates({ texCoord: 1 }, "asset", "texture")).toEqual({
      row0: [1, 0, 0, 1],
      row1: [0, 1, 0, 0],
    });
  });

  it("lowers scale, rotation, offset, and extension UV override to affine rows", () => {
    const prepared = prepareTextureCoordinates({
      extensions: {
        KHR_texture_transform: {
          offset: [0.25, -0.5],
          rotation: Math.PI / 2,
          scale: [2, 3],
          texCoord: 1,
        },
      },
      texCoord: 0,
    }, "asset", "texture");
    expect(prepared.row0).toEqual([expect.closeTo(0), -3, 0.25, 1]);
    expect(prepared.row1).toEqual([2, expect.closeTo(0), -0.5, 0]);
    expect(transformTextureCoordinates(prepared, [10, 20], [2, 4])).toEqual([
      expect.closeTo(-11.75),
      expect.closeTo(3.5),
    ]);
  });

  it("rejects non-finite transforms and unsupported UV sets before rendering", () => {
    expect(() => prepareTextureCoordinates({ texCoord: 2 }, "asset", "texture"))
      .toThrow("must select TEXCOORD_0 or TEXCOORD_1");
    expect(() => prepareTextureCoordinates({
      extensions: { KHR_texture_transform: { rotation: Number.NaN } },
    }, "asset", "texture")).toThrow("rotation: must be finite");
  });
});
