import { describe, expect, it } from "vitest";
import { inspectionArea } from "../../packages/renderer-webgl/src/texture/inspection-area";
import { environmentInspectionPixels } from "../../packages/renderer-webgl/src/environment/inspection-pixels";
import type { PreparedRoyalEnvironment } from "../../packages/renderer-webgl/src/environment/royal-environment-ktx1";

// Pre-optimization arithmetic, deliberately kept independent of lookup tables.
const unpack = (bits: number, mantissaBits: number): number => {
  const exponent = bits >>> mantissaBits;
  const mantissa = bits & ((1 << mantissaBits) - 1);
  return exponent === 0 ? mantissa * 2 ** (1 - 15 - mantissaBits)
    : exponent === 31 ? 0 : (1 + mantissa / 2 ** mantissaBits) * 2 ** (exponent - 15);
};
const display = (value: number): number => {
  const mapped = value / (1 + value);
  return Math.round(255 * (mapped <= 0.0031308 ? 12.92 * mapped : 1.055 * mapped ** (1 / 2.4) - 0.055));
};

/** One bounded contact sheet of all six HDR faces at the requested roughness mip. */
const reference = (source: PreparedRoyalEnvironment, mip = 0) => {
  const level = source.levels[mip];
  if (level === undefined) throw new Error("Royal texture inspection requires environment faces");
  const size = Math.min(85, level.size);
  const width = size * 3, height = size * 2;
  const pixels = { data: new Uint8ClampedArray(width * height * 4) };
  const bytes = new DataView(source.source);
  for (const face of level.faces) {
    const reduced = inspectionArea(level.size, level.size, size, size, 3, (x, y, values) => {
      const packed = bytes.getUint32(face.byteOffset + (y * level.size + x) * 4, true);
      values[0] = unpack(packed & 0x7ff, 6);
      values[1] = unpack((packed >>> 11) & 0x7ff, 6);
      values[2] = unpack(packed >>> 22, 5);
    });
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const output = ((Math.floor(face.face / 3) * size + y) * width + (face.face % 3) * size + x) * 4;
      for (let c = 0; c < 3; c++) pixels.data[output + c] = display(reduced[(y * size + x) * 3 + c]!);
      pixels.data[output + 3] = 255;
    }
  }
  return { width, height, rgba: pixels.data };
};


describe("HDR inspection lookup equivalence", () => {
  it.each([1, 32, 85, 128, 256])("preserves every overview byte for %i faces", size => {
    // Offset storage and permuted face descriptors exercise contact-sheet placement.
    const words = new Uint32Array(7 + size * size * 6);
    for (let i = 7; i < words.length; i++) {
      const value = i - 7;
      words[i] = (value & 2047) | (((value * 13) & 2047) << 11) | (((value * 29) & 1023) << 22);
    }
    const source = {
      size, source: words.buffer, metadata: {},
      levels: [{ size, level: 0, faces: [5, 3, 1, 4, 2, 0].map(face => ({ face, byteOffset: (7 + face * size * size) * 4, byteLength: size * size * 4 })) }],
    } as unknown as PreparedRoyalEnvironment;
    const before = words.slice();
    expect(environmentInspectionPixels(source)).toEqual(reference(source));
    expect(words).toEqual(before);
    expect(() => environmentInspectionPixels(source, 1)).toThrow("requires environment faces");
  });
});
