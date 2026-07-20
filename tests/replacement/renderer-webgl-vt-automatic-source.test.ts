import { describe, expect, it } from "vitest";
import {
  automaticVirtualTextureEligible,
  createAutomaticRasterPageSource,
  planAutomaticVirtualTextureAxis,
} from "../../packages/renderer-webgl/src/virtual-texture/automatic-page-source";

describe("automatic virtual texture page source", () => {
  it("selects only sufficiently large browser raster sources", () => {
    expect(automaticVirtualTextureEligible({
      height: 128,
      source: {} as ImageBitmap,
      width: 256,
    })).toBe(false);
    expect(automaticVirtualTextureEligible({
      height: 128,
      source: {} as ImageBitmap,
      width: 257,
    })).toBe(false);
    expect(automaticVirtualTextureEligible({
      height: 512,
      source: {} as ImageBitmap,
      width: 1024,
    })).toBe(true);
    expect(automaticVirtualTextureEligible({
      colorSpace: "srgb",
      height: 512,
      kind: "ktx2-etc2",
      levels: [],
      width: 512,
    })).toBe(false);
  });

  it("partitions clamp and mirrored gutters without changing destination coverage", () => {
    const clamped = planAutomaticVirtualTextureAxis(-2, 132, 512, 132, "clamp-to-edge");
    expect(clamped).toEqual([
      {
        destinationExtent: 2,
        destinationStart: 0,
        reversed: false,
        sourceExtent: 1,
        sourceStart: 0,
      },
      {
        destinationExtent: 130,
        destinationStart: 2,
        reversed: false,
        sourceExtent: 130,
        sourceStart: 0,
      },
    ]);
    const mirrored = planAutomaticVirtualTextureAxis(-2, 132, 128, 132, "mirrored-repeat");
    expect(mirrored).toEqual([
      {
        destinationExtent: 2,
        destinationStart: 0,
        reversed: true,
        sourceExtent: 2,
        sourceStart: 0,
      },
      {
        destinationExtent: 128,
        destinationStart: 2,
        reversed: false,
        sourceExtent: 128,
        sourceStart: 0,
      },
      {
        destinationExtent: 2,
        destinationStart: 130,
        reversed: true,
        sourceExtent: 2,
        sourceStart: 126,
      },
    ]);
  });

  it("derives one complete generated manifest from decoded dimensions", () => {
    const source = createAutomaticRasterPageSource({
      height: 1024,
      source: {} as ImageBitmap,
      width: 2048,
    }, {
      magFilter: "linear",
      minFilter: "linear-mipmap-linear",
      wrapS: "repeat",
      wrapT: "clamp-to-edge",
    }, "srgb");
    expect(source.manifest).toMatchObject({
      borderTexels: 2,
      colorSpace: "srgb",
      height: 1024,
      mipCount: 5,
      pageAddressing: "complete",
      pageEncoding: "image",
      pageSize: 128,
      width: 2048,
    });
  });
});
