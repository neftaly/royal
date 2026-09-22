import { inspectionArea } from "../texture/inspection-area";
import type { PreparedRoyalEnvironment } from "./royal-environment-ktx1";

const unpack = (bits: number, mantissaBits: number): number => {
  const exponent = bits >>> mantissaBits;
  const mantissa = bits & ((1 << mantissaBits) - 1);
  return exponent === 0 ? mantissa * 2 ** (1 - 15 - mantissaBits)
    : exponent === 31 ? 0 : (1 + mantissa / 2 ** mantissaBits) * 2 ** (exponent - 15);
};
// Every representable packed value is exactly reproducible in Float64. Keep
// exponentiation out of the per-texel loop, including subnormal/invalid values.
const rg = Float64Array.from({ length: 2048 }, (_, bits) => unpack(bits, 6));
const blue = Float64Array.from({ length: 1024 }, (_, bits) => unpack(bits, 5));
const display = (value: number): number => {
  const mapped = value / (1 + value);
  return Math.round(255 * (mapped <= 0.0031308 ? 12.92 * mapped : 1.055 * mapped ** (1 / 2.4) - 0.055));
};

const rgDisplay = Uint8ClampedArray.from(rg, display);
const blueDisplay = Uint8ClampedArray.from(blue, display);

/** Exact packed HDR reduction, shared by the browser sampler and pixel oracle tests. */
export const environmentInspectionPixels = (source: PreparedRoyalEnvironment, mip = 0): Readonly<{ width: number; height: number; rgba: Uint8ClampedArray }> => {
  const level = source.levels[mip];
  if (level === undefined) throw new Error("Royal texture inspection requires environment faces");
  const size = Math.min(85, level.size);
  const width = size * 3, height = size * 2;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const bytes = new DataView(source.source);
  for (const face of level.faces) {
    if (level.size <= 85) {
      // No averaging: each output is one exact decoded/tone-mapped texel.
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const packed = bytes.getUint32(face.byteOffset + (y * size + x) * 4, true);
        const output = ((Math.floor(face.face / 3) * size + y) * width + (face.face % 3) * size + x) * 4;
        rgba[output] = rgDisplay[packed & 0x7ff]!;
        rgba[output + 1] = rgDisplay[(packed >>> 11) & 0x7ff]!;
        rgba[output + 2] = blueDisplay[packed >>> 22]!;
        rgba[output + 3] = 255;
      }
      continue;
    }
    const reduced = inspectionArea(level.size, level.size, size, size, 3, (x, y, values) => {
      const packed = bytes.getUint32(face.byteOffset + (y * level.size + x) * 4, true);
      values[0] = rg[packed & 0x7ff]!;
      values[1] = rg[(packed >>> 11) & 0x7ff]!;
      values[2] = blue[packed >>> 22]!;
    });
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const output = ((Math.floor(face.face / 3) * size + y) * width + (face.face % 3) * size + x) * 4;
      for (let c = 0; c < 3; c++) rgba[output + c] = display(reduced[(y * size + x) * 3 + c]!);
      rgba[output + 3] = 255;
    }
  }
  return { width, height, rgba };
};
