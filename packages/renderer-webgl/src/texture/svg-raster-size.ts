import type { TextureStorageSize } from "./storage-fit";

// SVG physical units at 12 pixels/mm; pixel and unitless lengths stay in pixels.
const PIXELS_PER_UNIT: Readonly<Record<string, number>> = {
  "": 1, px: 1, mm: 12, cm: 120, in: 304.8, pt: 304.8 / 72, pc: 304.8 / 6, q: 3,
};

const length = (value: string | null): number | undefined => {
  const match = value?.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px|mm|cm|in|pt|pc|q)?$/i);
  if (match === undefined || match === null) return undefined;
  const pixels = Number(match[1]) * PIXELS_PER_UNIT[(match[2] ?? "").toLowerCase()]!;
  if (!Number.isFinite(pixels) || pixels <= 0) throw new RangeError("Royal SVG dimensions must be finite positive lengths");
  return pixels;
};

/** Resolve declared SVG dimensions independently of mesh scale and camera demand. */
export const svgRasterSize = (
  width: string | null,
  height: string | null,
  viewBox: string | null,
  naturalWidth: number,
  naturalHeight: number,
): TextureStorageSize => {
  const box = viewBox?.trim().split(/[\s,]+/).map(Number);
  const boxWidth = box?.[2] ?? 0;
  const boxHeight = box?.[3] ?? 0;
  const ratio = box?.length === 4 && box.every(Number.isFinite) && boxWidth > 0 && boxHeight > 0
    ? boxWidth / boxHeight : undefined;
  const declaredWidth = length(width);
  const declaredHeight = length(height);
  let resolvedWidth = declaredWidth ?? (declaredHeight !== undefined && ratio !== undefined
    ? declaredHeight * ratio : naturalWidth);
  let resolvedHeight = declaredHeight ?? (declaredWidth !== undefined && ratio !== undefined
    ? declaredWidth / ratio : naturalHeight);
  if (!(resolvedWidth > 0) && !(resolvedHeight > 0)) {
    resolvedWidth = ratio === undefined ? 300 : Math.min(300, 150 * ratio);
    resolvedHeight = ratio === undefined ? 150 : resolvedWidth / ratio;
  }
  if (!(resolvedWidth > 0)) resolvedWidth = 300;
  if (!(resolvedHeight > 0)) resolvedHeight = 150;
  resolvedWidth = Math.max(1, Math.round(resolvedWidth));
  resolvedHeight = Math.max(1, Math.round(resolvedHeight));
  if (!Number.isSafeInteger(resolvedWidth) || !Number.isSafeInteger(resolvedHeight)) {
    throw new RangeError("Royal SVG raster dimensions exceed safe integer range");
  }
  return { width: resolvedWidth, height: resolvedHeight };
};
