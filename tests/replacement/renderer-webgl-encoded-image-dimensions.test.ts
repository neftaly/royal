import { describe, expect, it } from "vitest";
import {
  encodedImageDimensionPrefixByteLength,
  readEncodedImageDimensions,
} from "../../packages/renderer-webgl/src/texture/encoded-image-dimensions";
import { forEachFuzzCase } from "../fuzz";
import { createAvifHeader } from "./support/avif-header";

const pngHeader = (width: number, height: number): Uint8Array => {
  const bytes = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10,
    0, 0, 0, 13,
    73, 72, 68, 82,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
};

describe("encoded image dimension hints", () => {
  it("reads fixed-header formats without copying a container-sized prefix", () => {
    expect(encodedImageDimensionPrefixByteLength("image/png")).toBe(24);
    expect(encodedImageDimensionPrefixByteLength("IMAGE/WEBP; charset=binary")).toBe(30);
    expect(encodedImageDimensionPrefixByteLength("image/jpeg")).toBe(16 * 1024);
    expect(encodedImageDimensionPrefixByteLength("image/avif")).toBe(128 * 1024);
    expect(encodedImageDimensionPrefixByteLength("")).toBe(128 * 1024);
    expect(encodedImageDimensionPrefixByteLength("image/svg+xml")).toBeUndefined();
  });

  it("reads PNG IHDR dimensions without requiring the image payload", () => {
    expect(readEncodedImageDimensions(pngHeader(2048, 1024))).toEqual({
      height: 1024,
      width: 2048,
    });
  });

  it("walks JPEG metadata segments to a progressive start-of-frame marker", () => {
    const bytes = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe1, 0x00, 0x05, 1, 2, 3,
      0xff, 0xc2, 0x00, 0x0b, 8, 0x03, 0x20, 0x05, 0x00, 3, 1, 1, 0,
    ]);
    expect(readEncodedImageDimensions(bytes)).toEqual({ height: 800, width: 1280 });
  });

  it("reads extended, lossless, and lossy WebP dimensions", () => {
    const extended = new Uint8Array(30);
    extended.set([82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80], 0);
    extended.set([86, 80, 56, 88, 10, 0, 0, 0], 12);
    extended.set([0xff, 0x07, 0], 24);
    extended.set([0xff, 0x03, 0], 27);
    expect(readEncodedImageDimensions(extended)).toEqual({ height: 1024, width: 2048 });

    const lossless = new Uint8Array(25);
    lossless.set([82, 73, 70, 70, 17, 0, 0, 0, 87, 69, 66, 80], 0);
    lossless.set([86, 80, 56, 76, 5, 0, 0, 0, 0x2f], 12);
    new DataView(lossless.buffer).setUint32(21, (799 << 14) | 1279, true);
    expect(readEncodedImageDimensions(lossless)).toEqual({ height: 800, width: 1280 });

    const lossy = new Uint8Array(30);
    lossy.set([82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80], 0);
    lossy.set([86, 80, 56, 32, 10, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a], 12);
    const lossyView = new DataView(lossy.buffer);
    lossyView.setUint16(26, 640, true);
    lossyView.setUint16(28, 360, true);
    expect(readEncodedImageDimensions(lossy)).toEqual({ height: 360, width: 640 });
  });

  it("resolves AVIF dimensions through primary-item property associations", () => {
    expect(readEncodedImageDimensions(createAvifHeader(2048, 1024))).toEqual({
      height: 1024,
      width: 2048,
    });
    expect(readEncodedImageDimensions(createAvifHeader(512, 2048, {
      itemId: 0x1_0001,
      wide: true,
    }))).toEqual({ height: 2048, width: 512 });
  });

  it("does not accept an unassociated AVIF spatial property", () => {
    const bytes = createAvifHeader(1280, 720);
    const association = bytes.lastIndexOf(0x81);
    bytes[association] = 0x82;
    expect(readEncodedImageDimensions(bytes)).toBeUndefined();
  });

  it("rejects truncated AVIF metadata and a non-AVIF minor-version lookalike", () => {
    const truncated = createAvifHeader(1280, 720);
    expect(readEncodedImageDimensions(truncated.subarray(0, truncated.length - 1))).toBeUndefined();

    const lookalike = createAvifHeader(1280, 720);
    lookalike.set(new TextEncoder().encode("mif1avifmif1"), 8);
    expect(readEncodedImageDimensions(lookalike)).toBeUndefined();
  });

  it("returns no hint for truncated, zero-sized, or unknown input", () => {
    expect(readEncodedImageDimensions(pngHeader(0, 1))).toBeUndefined();
    expect(readEncodedImageDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 20])))
      .toBeUndefined();
    expect(readEncodedImageDimensions(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8X")))
      .toBeUndefined();
    expect(readEncodedImageDimensions(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
  });

  it("never throws while scanning bounded adversarial prefixes", () => {
    forEachFuzzCase({
      cases: 2_000,
      envName: "ROYAL_IMAGE_HEADER_FUZZ_CASES",
      seed: 0x51_f1_5e,
    }, ({ random }) => {
      const bytes = new Uint8Array(random.int(0, 256));
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = random.int(0, 256);
      }
      readEncodedImageDimensions(bytes);
    });
  });
});
