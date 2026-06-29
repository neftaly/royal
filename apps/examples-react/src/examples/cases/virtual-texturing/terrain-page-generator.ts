export type TerrainPageAddress = {
  readonly mip: number;
  readonly x: number;
  readonly y: number;
};

export type TerrainPageGenerationRequest = {
  readonly height: number;
  readonly sourcePage: TerrainPageAddress;
  readonly width: number;
};

const virtualSize = [4096, 4096] as const;
const pageSize = 64;
const basePageColumns = virtualSize[0] / pageSize;
const basePageRows = virtualSize[1] / pageSize;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const clampByte = (value: number): number => clamp(Math.round(value), 0, 255);

const smoothStep = (edge0: number, edge1: number, value: number): number => {
  const range = edge1 - edge0;
  const t = range === 0 ? 0 : clamp((value - edge0) / range, 0, 1);
  return t * t * (3 - 2 * t);
};

const mix = (a: number, b: number, t: number): number => a * (1 - t) + b * t;

const mixColor = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): readonly [number, number, number] => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
];

const fract = (value: number): number => value - Math.floor(value);

const hash2 = (x: number, y: number): number => {
  const dot = x * 127.1 + y * 311.7;
  return fract(Math.sin(dot) * 43_758.5453);
};

const gridLine = (coordinate: number, spacing: number, width: number): number => {
  const phase = fract(coordinate / spacing);
  const distance = Math.min(phase, 1 - phase) * spacing;

  return 1 - smoothStep(width * 0.45, width, distance);
};

export const terrainElevation = (u: number, v: number): number => {
  const x = (clamp(u, 0, 1) - 0.5) * 2;
  const z = (clamp(v, 0, 1) - 0.5) * 2;
  const ridge = Math.sin((x * 1.14 - z * 0.38) * Math.PI) * 0.16;
  const crossRidge = Math.sin((x * 0.42 + z * 1.28) * Math.PI * 1.3) * 0.08;
  const peak = Math.exp(-((x + 0.18) ** 2 * 5.6 + (z - 0.03) ** 2 * 7.2)) * 1.1;
  const shoulder = Math.exp(-((x - 0.34) ** 2 * 8.2 + (z + 0.36) ** 2 * 4.8)) * 0.48;
  const basin = Math.exp(-((x + 0.56) ** 2 * 9 + (z + 0.42) ** 2 * 8)) * 0.34;

  return -0.28 + peak + shoulder + ridge + crossRidge - basin;
};

const terrainColorAt = (
  u: number,
  v: number,
): readonly [number, number, number] => {
  const height = terrainElevation(u, v);
  const moisture = Math.sin((u * 5.3 + v * 2.1) * Math.PI) * 0.5 + 0.5;
  const virtualX = clamp(u, 0, 1) * (virtualSize[0] - 1);
  const virtualY = clamp(v, 0, 1) * (virtualSize[1] - 1);
  const texelX = Math.floor(virtualX);
  const texelY = Math.floor(virtualY);
  const noise = hash2(texelX, texelY);
  const detail = Math.sin((u * 193 + v * 89) * Math.PI) * 0.5 + 0.5;
  const lowland = [84, 122, 78] as const;
  const grass = [106, 156, 88] as const;
  const scrub = [142, 136, 86] as const;
  const rock = [128, 127, 122] as const;
  const snow = [228, 233, 226] as const;
  const wet = [58, 94, 92] as const;
  const ink = [32, 42, 48] as const;
  const surveyCyan = [96, 226, 216] as const;
  const surveyAmber = [240, 202, 96] as const;
  const grassMix = mixColor(lowland, grass, smoothStep(-0.18, 0.32, height));
  const scrubMix = mixColor(grassMix, scrub, smoothStep(0.16, 0.5, height) * (1 - moisture * 0.3));
  const rockMix = mixColor(scrubMix, rock, smoothStep(0.48, 0.86, height + detail * 0.08));
  const snowMix = mixColor(rockMix, snow, smoothStep(0.9, 1.12, height + detail * 0.05));
  const dampMix = mixColor(wet, snowMix, smoothStep(-0.32, -0.06, height + moisture * 0.08));
  const contourPhase = Math.abs(fract((height + 1.45) * 18) - 0.5) * 2;
  const contour = 1 - smoothStep(0.06, 0.12, contourPhase);
  const majorGrid = Math.max(gridLine(virtualX, 256, 2.2), gridLine(virtualY, 256, 2.2));
  const minorGrid = Math.max(gridLine(virtualX, 64, 1.35), gridLine(virtualY, 64, 1.35));
  const microGrid = Math.max(gridLine(virtualX, 16, 0.72), gridLine(virtualY, 16, 0.72));
  const diagonal = gridLine((virtualX + virtualY) * 0.7071, 32, 0.8);
  const tileX = Math.floor(virtualX / 256);
  const tileY = Math.floor(virtualY / 256);
  const tileU = fract(virtualX / 256);
  const tileV = fract(virtualY / 256);
  const markerColumn = Math.floor((tileU - 0.055) / 0.027);
  const markerRow = Math.floor((tileV - 0.06) / 0.035);
  const markerBand = tileU > 0.055 && tileU < 0.34 && tileV > 0.06 && tileV < 0.19;
  const markerBit = markerBand &&
    ((tileX * 13 + tileY * 29 + markerColumn * 5 + markerRow * 7) % 11 < 5);
  const grain = 0.92 + noise * 0.12 + detail * 0.04;
  const contourColor = mixColor(ink, surveyAmber, smoothStep(0.62, 1.02, height));
  const gridColor = mixColor(surveyCyan, ink, smoothStep(0.0, 0.8, height));
  const marked = markerBit ? mixColor(dampMix, surveyAmber, 0.78) : dampMix;
  const withMinorGrid = mixColor(marked, gridColor, minorGrid * 0.34 + microGrid * 0.2 + diagonal * 0.14);
  const withMajorGrid = mixColor(withMinorGrid, surveyCyan, majorGrid * 0.72);
  const withContour = mixColor(withMajorGrid, contourColor, contour * 0.64);

  return [
    clampByte(withContour[0] * grain),
    clampByte(withContour[1] * (0.94 + moisture * 0.1)),
    clampByte(withContour[2] * (0.94 + detail * 0.08)),
  ];
};

const pagesAtVirtualMip = (mip: number): readonly [number, number] => [
  Math.max(1, Math.ceil(basePageColumns / 2 ** mip)),
  Math.max(1, Math.ceil(basePageRows / 2 ** mip)),
];

const pageVirtualUv = (
  page: TerrainPageAddress,
  localU: number,
  localV: number,
): readonly [number, number] => {
  const [mipColumns, mipRows] = pagesAtVirtualMip(page.mip);

  return [
    clamp((page.x + localU) / mipColumns, 0, 1),
    clamp((page.y + localV) / mipRows, 0, 1),
  ];
};

export const createTerrainPhysicalPagePixels = (
  request: TerrainPageGenerationRequest,
  buffer?: ArrayBuffer,
): Uint8Array => {
  const byteLength = request.width * request.height * 4;
  const pixels = buffer === undefined ? new Uint8Array(byteLength) : new Uint8Array(buffer, 0, byteLength);

  for (let y = 0; y < request.height; y += 1) {
    for (let x = 0; x < request.width; x += 1) {
      const index = (y * request.width + x) * 4;
      const localU = request.width <= 1 ? 0 : x / (request.width - 1);
      const localV = request.height <= 1 ? 0 : y / (request.height - 1);
      const [virtualU, virtualV] = pageVirtualUv(request.sourcePage, localU, localV);
      const color = terrainColorAt(virtualU, virtualV);
      const edge = x < 2 || y < 2 || x >= request.width - 2 || y >= request.height - 2;

      pixels[index] = edge ? 20 : color[0];
      pixels[index + 1] = edge ? 28 : color[1];
      pixels[index + 2] = edge ? 36 : color[2];
      pixels[index + 3] = 255;
    }
  }

  return pixels;
};
