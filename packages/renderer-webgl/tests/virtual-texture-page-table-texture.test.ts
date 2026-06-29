import { describe, expect, it } from "vitest";

import type { RendererWebGlContext } from "../src/gl";
import { VirtualTextureRuntime } from "../src/virtual-texture-runtime";
import {
  createVirtualTexturePageTableTexture,
  uploadVirtualTexturePageTableTexels,
  virtualTexturePageTableMipDimensions,
} from "../src/virtual-texture-page-table-texture";
import { planVirtualTextureUploads } from "../src/virtual-texture-upload-plan";

type TexImage2DCall = {
  readonly border: number;
  readonly format: number;
  readonly height: number;
  readonly internalFormat: number;
  readonly level: number;
  readonly pixels: ArrayBufferView | null;
  readonly target: number;
  readonly type: number;
  readonly width: number;
};

type TexParameterCall = {
  readonly param: number;
  readonly pname: number;
  readonly target: number;
};

type TexSubImage2DCall = {
  readonly data: readonly number[];
  readonly format: number;
  readonly height: number;
  readonly level: number;
  readonly target: number;
  readonly type: number;
  readonly width: number;
  readonly xOffset: number;
  readonly yOffset: number;
};

const fakePageTableGl = (): {
  readonly boundTextures: readonly (WebGLTexture | null)[];
  readonly gl: RendererWebGlContext;
  readonly texImages: readonly TexImage2DCall[];
  readonly texParameters: readonly TexParameterCall[];
  readonly texSubImages: readonly TexSubImage2DCall[];
} => {
  const boundTextures: (WebGLTexture | null)[] = [];
  const texImages: TexImage2DCall[] = [];
  const texParameters: TexParameterCall[] = [];
  const texSubImages: TexSubImage2DCall[] = [];
  const texture = { id: 1 } as WebGLTexture;

  return {
    boundTextures,
    gl: {
      CLAMP_TO_EDGE: 0x812F,
      NEAREST: 0x2600,
      RGBA: 0x1908,
      RGBA8: 0x8058,
      TEXTURE_2D: 0x0DE1,
      TEXTURE_MAG_FILTER: 0x2800,
      TEXTURE_MIN_FILTER: 0x2801,
      TEXTURE_WRAP_S: 0x2802,
      TEXTURE_WRAP_T: 0x2803,
      UNSIGNED_BYTE: 0x1401,
      bindTexture(_target: GLenum, value: WebGLTexture | null) {
        boundTextures.push(value);
      },
      createTexture: () => texture,
      texImage2D(
        target: GLenum,
        level: GLint,
        internalFormat: GLint,
        width: GLsizei,
        height: GLsizei,
        border: GLint,
        format: GLenum,
        type: GLenum,
        pixels: ArrayBufferView | null,
      ) {
        texImages.push({ border, format, height, internalFormat, level, pixels, target, type, width });
      },
      texParameteri(target: GLenum, pname: GLenum, param: GLint) {
        texParameters.push({ param, pname, target });
      },
      texSubImage2D(
        target: GLenum,
        level: GLint,
        xOffset: GLint,
        yOffset: GLint,
        width: GLsizei,
        height: GLsizei,
        format: GLenum,
        type: GLenum,
        pixels: ArrayBufferView,
      ) {
        texSubImages.push({
          data: [...new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)],
          format,
          height,
          level,
          target,
          type,
          width,
          xOffset,
          yOffset,
        });
      },
    } as unknown as RendererWebGlContext,
    texImages,
    texParameters,
    texSubImages,
  };
};

describe("virtual texture page-table texture", () => {
  it("computes page-table mip dimensions from virtual page geometry", () => {
    expect(virtualTexturePageTableMipDimensions({
      mipCount: 4,
      pageSize: 128,
      virtualSize: [640, 257],
    })).toEqual([
      { height: 3, width: 5 },
      { height: 2, width: 3 },
      { height: 1, width: 2 },
      { height: 1, width: 1 },
    ]);
  });

  it("allocates one RGBA8 texture level per page-table mip", () => {
    const { gl, texImages, texParameters } = fakePageTableGl();

    const pageTable = createVirtualTexturePageTableTexture(gl, [
      { height: 4, width: 8 },
      { height: 2, width: 4 },
      { height: 1, width: 2 },
    ]);

    expect(pageTable.mipDimensions).toEqual([
      { height: 4, width: 8 },
      { height: 2, width: 4 },
      { height: 1, width: 2 },
    ]);
    expect(texImages).toEqual([
      {
        border: 0,
        format: gl.RGBA,
        height: 4,
        internalFormat: gl.RGBA8,
        level: 0,
        pixels: null,
        target: gl.TEXTURE_2D,
        type: gl.UNSIGNED_BYTE,
        width: 8,
      },
      {
        border: 0,
        format: gl.RGBA,
        height: 2,
        internalFormat: gl.RGBA8,
        level: 1,
        pixels: null,
        target: gl.TEXTURE_2D,
        type: gl.UNSIGNED_BYTE,
        width: 4,
      },
      {
        border: 0,
        format: gl.RGBA,
        height: 1,
        internalFormat: gl.RGBA8,
        level: 2,
        pixels: null,
        target: gl.TEXTURE_2D,
        type: gl.UNSIGNED_BYTE,
        width: 2,
      },
    ]);
    expect(texParameters).toEqual([
      { param: gl.NEAREST, pname: gl.TEXTURE_MIN_FILTER, target: gl.TEXTURE_2D },
      { param: gl.NEAREST, pname: gl.TEXTURE_MAG_FILTER, target: gl.TEXTURE_2D },
      { param: gl.CLAMP_TO_EDGE, pname: gl.TEXTURE_WRAP_S, target: gl.TEXTURE_2D },
      { param: gl.CLAMP_TO_EDGE, pname: gl.TEXTURE_WRAP_T, target: gl.TEXTURE_2D },
    ]);
  });

  it("uploads dirty page-table texels with deterministic offsets and bytes", () => {
    const runtime = new VirtualTextureRuntime({
      pageSize: 128,
      physicalSlots: 4,
      virtualSize: [512, 512],
    });
    runtime.makeResident({ mip: 1, x: 1, y: 1 }, 1);
    runtime.drainDirtyEntries();
    runtime.resolve({ mip: 0, x: 2, y: 3 }, 2);
    runtime.resolve({ mip: 0, x: 0, y: 0 }, 3);

    const plan = planVirtualTextureUploads(runtime.drainDirtyEntries(4), { pageSize: 128 });
    const { gl, texSubImages } = fakePageTableGl();
    const pageTable = createVirtualTexturePageTableTexture(
      gl,
      virtualTexturePageTableMipDimensions({
        mipCount: runtime.mipCount,
        pageSize: 128,
        virtualSize: [512, 512],
      }),
    );

    const result = uploadVirtualTexturePageTableTexels(gl, pageTable, plan.pageTableUploads);

    expect(result).toEqual({ bytesUploaded: 8, texelsUploaded: 2 });
    expect(texSubImages).toEqual([
      {
        data: [0, 0, 1, 5],
        format: gl.RGBA,
        height: 1,
        level: 0,
        target: gl.TEXTURE_2D,
        type: gl.UNSIGNED_BYTE,
        width: 1,
        xOffset: 2,
        yOffset: 3,
      },
      {
        data: [0, 0, 0, 0],
        format: gl.RGBA,
        height: 1,
        level: 0,
        target: gl.TEXTURE_2D,
        type: gl.UNSIGNED_BYTE,
        width: 1,
        xOffset: 0,
        yOffset: 0,
      },
    ]);
  });

  it("rejects page-table uploads outside allocated mip bounds", () => {
    const runtime = new VirtualTextureRuntime({
      pageSize: 128,
      physicalSlots: 4,
      virtualSize: [512, 512],
    });
    runtime.makeResident({ mip: 1, x: 1, y: 1 }, 1);
    runtime.drainDirtyEntries();
    runtime.resolve({ mip: 0, x: 2, y: 3 }, 2);
    const plan = planVirtualTextureUploads(runtime.drainDirtyEntries(3), { pageSize: 128 });
    const { gl } = fakePageTableGl();
    const pageTable = createVirtualTexturePageTableTexture(gl, [{ height: 2, width: 2 }]);

    expect(() => uploadVirtualTexturePageTableTexels(gl, pageTable, plan.pageTableUploads)).toThrow(
      "Virtual texture page-table upload 2,3 exceeds 2x2 level 0",
    );
  });
});
