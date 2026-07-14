import { describe, expect, it } from "vitest";
import {
  validateVirtualTexturePageImage,
  virtualTexturePageImageDimensions,
} from "../packages/renderer-webgl/src/virtual-texture-page-image";
import type { VirtualTextureManifestModel } from "../packages/renderer-webgl/src/virtual-texturing";

const manifest: VirtualTextureManifestModel = {
  borderTexels: 2,
  height: 128,
  pageAddressing: "sparse",
  pageEncoding: "image",
  pageSize: 64,
  pages: [],
  width: 128,
};

const image = (value: object): TexImageSource => value as TexImageSource;

describe("virtual texture page image contract", () => {
  it("requires the complete stored cell rather than only the logical interior", () => {
    expect(validateVirtualTexturePageImage(manifest, image({ height: 68, width: 68 }))).toEqual({
      height: 68,
      kind: "valid",
      storedPageSize: 68,
      width: 68,
    });
    expect(validateVirtualTexturePageImage(manifest, image({ height: 64, width: 64 }))).toEqual({
      height: 64,
      kind: "invalid",
      storedPageSize: 68,
      width: 64,
    });
  });

  it("uses intrinsic image, video, and frame dimensions before layout dimensions", () => {
    expect(virtualTexturePageImageDimensions(image({
      height: 12,
      naturalHeight: 68,
      naturalWidth: 68,
      videoHeight: 34,
      videoWidth: 34,
      width: 12,
    }))).toEqual({ height: 68, width: 68 });
    expect(virtualTexturePageImageDimensions(image({
      height: 12,
      naturalHeight: 0,
      naturalWidth: 0,
      videoHeight: 68,
      videoWidth: 68,
      width: 12,
    }))).toEqual({ height: 68, width: 68 });
    expect(virtualTexturePageImageDimensions(image({
      displayHeight: 68,
      displayWidth: 68,
      height: 12,
      width: 12,
    }))).toEqual({ height: 68, width: 68 });
  });

  it("reports missing and partial dimensions without inventing a valid extent", () => {
    expect(validateVirtualTexturePageImage(manifest, image({}))).toEqual({
      kind: "invalid",
      storedPageSize: 68,
    });
    expect(validateVirtualTexturePageImage(manifest, image({ width: 68 }))).toEqual({
      kind: "invalid",
      storedPageSize: 68,
      width: 68,
    });
  });
});
