import { inspectionArea } from "./inspection-area";

export type InspectionRgba = Readonly<{
  rgba: Uint8Array;
  inputWidth: number;
  inputHeight: number;
  width: number;
  height: number;
}>;
export type InspectionReduction = Readonly<{ reduced: Float64Array; transparent: boolean }>;

/** Shared arithmetic for local and worker reduction; includes raw and composited RGB. */
export const reduceInspectionRgba = ({ rgba, inputWidth, inputHeight, width, height }: InspectionRgba): InspectionReduction => {
  let transparent = false;
  const sx = inputWidth / width, sy = inputHeight / height;
  // Common power-of-two textures have integer footprints. Keep the same weighted
  // addition order, but avoid a callback and seven typed-array writes per texel.
  if (Number.isInteger(sx) && Number.isInteger(sy)) {
    const reduced = new Float64Array(width * height * 7);
    const weight = 1 / (sx * sy);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, ar = 0, ag = 0, ab = 0, white = 0;
      for (let iy = y * sy; iy < (y + 1) * sy; iy++) {
        const end = (iy * inputWidth + (x + 1) * sx) * 4;
        for (let i = (iy * inputWidth + x * sx) * 4; i < end; i += 4) {
          const alpha = rgba[i + 3]! / 255;
          if (alpha < 1) transparent = true;
          r += rgba[i]! * weight; g += rgba[i + 1]! * weight; b += rgba[i + 2]! * weight;
          ar += rgba[i]! * alpha * weight; ag += rgba[i + 1]! * alpha * weight; ab += rgba[i + 2]! * alpha * weight;
          white += 255 * (1 - alpha) * weight;
        }
      }
      const offset = (y * width + x) * 7;
      reduced[offset] = r; reduced[offset + 1] = g; reduced[offset + 2] = b;
      reduced[offset + 3] = ar; reduced[offset + 4] = ag; reduced[offset + 5] = ab; reduced[offset + 6] = white;
    }
    return { reduced, transparent };
  }
  const reduced = inspectionArea(inputWidth, inputHeight, width, height, 7, (x, y, values) => {
    const offset = (y * inputWidth + x) * 4, alpha = rgba[offset + 3]! / 255;
    if (alpha < 1) transparent = true;
    for (let c = 0; c < 3; c++) {
      values[c] = rgba[offset + c]!;
      values[c + 3] = rgba[offset + c]! * alpha;
    }
    values[6] = 255 * (1 - alpha);
  });
  return { reduced, transparent };
};
