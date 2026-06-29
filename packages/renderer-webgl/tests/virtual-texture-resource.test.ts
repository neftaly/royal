import { describe, expect, it } from "vitest";

import type { RendererWebGlContext } from "../src/gl";
import { parseVirtualTextureManifest } from "../src/virtual-texture-manifest";
import { VirtualTextureResource } from "../src/virtual-texture-resource";

type TexImage2DCall = {
  readonly height: number;
  readonly internalFormat: number;
  readonly level: number;
  readonly texture: WebGLTexture | null;
  readonly width: number;
};

type TexSubImage2DCall = {
  readonly byteLength: number;
  readonly height: number;
  readonly level: number;
  readonly texture: WebGLTexture | null;
  readonly width: number;
  readonly xOffset: number;
  readonly yOffset: number;
};

const fakeVirtualTextureGl = (): {
  readonly deletedTextures: readonly WebGLTexture[];
  readonly gl: RendererWebGlContext;
  readonly texImages: readonly TexImage2DCall[];
  readonly texSubImages: readonly TexSubImage2DCall[];
} => {
  let nextTextureId = 0;
  let boundTexture: WebGLTexture | null = null;
  const deletedTextures: WebGLTexture[] = [];
  const texImages: TexImage2DCall[] = [];
  const texSubImages: TexSubImage2DCall[] = [];

  return {
    deletedTextures,
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
        boundTexture = value;
      },
      createTexture: () => {
        nextTextureId += 1;
        return { id: nextTextureId } as WebGLTexture;
      },
      deleteTexture(texture: WebGLTexture | null) {
        if (texture !== null) deletedTextures.push(texture);
      },
      texImage2D(
        _target: GLenum,
        level: GLint,
        internalFormat: GLint,
        width: GLsizei,
        height: GLsizei,
      ) {
        texImages.push({ height, internalFormat, level, texture: boundTexture, width });
      },
      texParameteri() {},
      texSubImage2D(
        _target: GLenum,
        level: GLint,
        xOffset: GLint,
        yOffset: GLint,
        width: GLsizei,
        height: GLsizei,
        _format: GLenum,
        _type: GLenum,
        pixels: ArrayBufferView,
      ) {
        texSubImages.push({
          byteLength: pixels.byteLength,
          height,
          level,
          texture: boundTexture,
          width,
          xOffset,
          yOffset,
        });
      },
    } as unknown as RendererWebGlContext,
    texImages,
    texSubImages,
  };
};

describe("VirtualTextureResource", () => {
  it("allocates page-table and physical atlas textures from a manifest", () => {
    const { gl, texImages } = fakeVirtualTextureGl();
    const manifest = parseVirtualTextureManifest({
      borderTexels: 4,
      id: "terrain:alpine",
      pageSize: 128,
      physicalSlots: 4,
      virtualSize: [512, 512],
    });

    const resource = new VirtualTextureResource(gl, manifest);

    expect(resource.pageTable.mipDimensions).toEqual([
      { height: 4, width: 4 },
      { height: 2, width: 2 },
      { height: 1, width: 1 },
    ]);
    expect(resource.physicalAtlas).toMatchObject({
      height: 272,
      paddedPageSize: 136,
      slotColumns: 2,
      slotRows: 2,
      width: 272,
    });
    expect(texImages.map((call) => [call.level, call.width, call.height, call.internalFormat])).toEqual([
      [0, 4, 4, gl.RGBA8],
      [1, 2, 2, gl.RGBA8],
      [2, 1, 1, gl.RGBA8],
      [0, 272, 272, gl.RGBA8],
    ]);
  });

  it("drains upload plans and tracks page-table plus physical atlas upload stats", () => {
    const { gl, texSubImages } = fakeVirtualTextureGl();
    const manifest = parseVirtualTextureManifest({
      borderTexels: 4,
      id: "terrain:alpine",
      pageSize: 128,
      physicalSlots: 4,
      virtualSize: [512, 512],
    });
    const resource = new VirtualTextureResource(gl, manifest);

    resource.makeResident({ mip: 0, x: 1, y: 2 }, 7);
    const batch = resource.drainUploadPlan(8);

    resource.uploadPageTable(batch.plan);
    const atlasUpload = batch.plan.physicalAtlasUploads[0];
    if (atlasUpload === undefined) throw new Error("expected physical atlas upload");
    resource.uploadPhysicalAtlasPage(atlasUpload, new Uint8Array(atlasUpload.byteLength));

    expect(batch.frame).toBe(8);
    expect(batch.plan.uploadCount).toBe(2);
    expect(resource.uploadStats).toEqual({
      bytesUploaded: 4 + 136 * 136 * 4,
      dirtyBatches: 1,
      lastFrame: 8,
      lastUploadCount: 2,
      pageTableBytesUploaded: 4,
      pageTableTexelsUploaded: 1,
      physicalAtlasBytesUploaded: 136 * 136 * 4,
      physicalAtlasPagesUploaded: 1,
    });
    expect(texSubImages.map((call) => [call.level, call.xOffset, call.yOffset, call.width, call.height])).toEqual([
      [0, 1, 2, 1, 1],
      [0, 0, 0, 136, 136],
    ]);
  });

  it("rejects physical atlas payloads with unexpected byte length and disposes textures", () => {
    const { deletedTextures, gl } = fakeVirtualTextureGl();
    const manifest = parseVirtualTextureManifest({
      id: "terrain:alpine",
      pageSize: 128,
      physicalSlots: 4,
      virtualSize: [512, 512],
    });
    const resource = new VirtualTextureResource(gl, manifest);

    resource.makeResident({ mip: 0, x: 0, y: 0 }, 1);
    const atlasUpload = resource.drainUploadPlan(2).plan.physicalAtlasUploads[0];
    if (atlasUpload === undefined) throw new Error("expected physical atlas upload");

    expect(() => resource.uploadPhysicalAtlasPage(atlasUpload, new Uint8Array(4))).toThrow(
      "Virtual texture physical atlas upload for m0/0/0 expected 65536 bytes, got 4",
    );
    resource.dispose();
    resource.dispose();

    expect(deletedTextures.length).toBe(2);
    expect(() => resource.drainUploadPlan(3)).toThrow("Virtual texture resource has been disposed");
  });
});
