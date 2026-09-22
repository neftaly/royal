import { inspectionArea } from "../texture/inspection-area";
import type { TextureInspector } from "../texture/inspection-policy";
import type { PreparedRoyalEnvironment } from "./royal-environment-ktx1";

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
export const environmentInspectionSample = (source: PreparedRoyalEnvironment, mip = 0): HTMLCanvasElement => {
  const level = source.levels[mip];
  if (level === undefined) throw new Error("Royal texture inspection requires environment faces");
  const size = Math.min(85, level.size);
  const canvas = document.createElement("canvas");
  canvas.width = size * 3; canvas.height = size * 2;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Royal texture inspection could not create an environment overview");
  const pixels = context.createImageData(canvas.width, canvas.height);
  const bytes = new DataView(source.source);
  for (const face of level.faces) {
    const reduced = inspectionArea(level.size, level.size, size, size, 3, (x, y, values) => {
      const packed = bytes.getUint32(face.byteOffset + (y * level.size + x) * 4, true);
      values[0] = unpack(packed & 0x7ff, 6);
      values[1] = unpack((packed >>> 11) & 0x7ff, 6);
      values[2] = unpack(packed >>> 22, 5);
    });
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const output = ((Math.floor(face.face / 3) * size + y) * canvas.width + (face.face % 3) * size + x) * 4;
      for (let c = 0; c < 3; c++) pixels.data[output + c] = display(reduced[(y * size + x) * 3 + c]!);
      pixels.data[output + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
};

/** Authored roughness levels are independent input and each must pass inspection. */
export const inspectEnvironment = async (
  inspector: TextureInspector,
  key: string,
  source: PreparedRoyalEnvironment,
  signal: AbortSignal,
): Promise<void> => {
  if (source.levels.length === 0) throw new Error("Royal texture inspection requires environment faces");
  for (let mip = 0; mip < source.levels.length; mip++) {
    await inspector.inspectPixels("environment:" + key, async () => environmentInspectionSample(source, mip), signal);
  }
};
