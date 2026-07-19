import { describe, expect, it } from "vitest";
import { readEncodedImageDimensions } from "../../packages/renderer-webgl/src/texture/encoded-image-dimensions";

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

  it("returns no hint for truncated, zero-sized, or unknown input", () => {
    expect(readEncodedImageDimensions(pngHeader(0, 1))).toBeUndefined();
    expect(readEncodedImageDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 20])))
      .toBeUndefined();
    expect(readEncodedImageDimensions(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
  });

  it("never throws while scanning bounded adversarial prefixes", () => {
    let state = 0x51f15e;
    for (let row = 0; row < 2_000; row += 1) {
      state = Math.imul(state ^ (state >>> 15), 0x2c1b3c6d);
      const bytes = new Uint8Array(state & 255);
      for (let index = 0; index < bytes.length; index += 1) {
        state = Math.imul(state ^ (state >>> 12), 0x297a2d39);
        bytes[index] = state;
      }
      readEncodedImageDimensions(bytes);
    }
  });
});
