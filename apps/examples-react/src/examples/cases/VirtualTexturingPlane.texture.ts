import {
  solidTexture,
  textureAsset,
  unlitMaterial,
  virtualTextureAsset,
  type UnlitMaterial,
} from '@royal/renderer-core';

export type SurfaceTextureDetail = 'coarse' | 'resolved';

const fallbackTexture = solidTexture({
  color: [0.08, 0.1, 0.12, 1],
  id: 'generated-virtual-texturing-fallback',
});
const textureSize = 1536;
const pageSize = 256;
const pageCount = textureSize / pageSize;
const surfaceSampler = {
  magFilter: 'linear',
  minFilter: 'linear-mipmap-linear',
  wrapS: 'clamp-to-edge',
  wrapT: 'clamp-to-edge',
} as const;
const coarsePalette = [
  '#133243',
  '#225169',
  '#2f6a73',
  '#3d4d78',
  '#496044',
  '#65495d',
] as const;
const detailPalette = [
  '#f8dc75',
  '#f4935a',
  '#e85f6f',
  '#f5f0d2',
  '#73d0c4',
] as const;

const paletteColor = (palette: readonly string[], index: number): string =>
  palette[index % palette.length] ?? '#ffffff';

const drawGrid = (
  context: CanvasRenderingContext2D,
  step: number,
  lineWidth: number,
  color: string,
): void => {
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  for (let offset = 0; offset <= textureSize; offset += step) {
    context.beginPath();
    context.moveTo(offset, 0);
    context.lineTo(offset, textureSize);
    context.moveTo(0, offset);
    context.lineTo(textureSize, offset);
    context.stroke();
  }
};

const drawLabel = (
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
): void => {
  context.fillStyle = 'rgba(6, 12, 18, 0.78)';
  context.fillRect(x - 14, y - 12, text.length * size * 0.65 + 28, size + 28);
  context.fillStyle = '#fff4c7';
  context.font = `700 ${size}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  context.textBaseline = 'top';
  context.fillText(text, x, y);
};

const drawResolvedPage = (
  context: CanvasRenderingContext2D,
  column: number,
  row: number,
): void => {
  const left = column * pageSize;
  const top = row * pageSize;
  const pageIndex = row * pageCount + column;

  context.save();
  context.beginPath();
  context.rect(left + 8, top + 8, pageSize - 16, pageSize - 16);
  context.clip();
  context.globalAlpha = 0.22;
  context.fillStyle = paletteColor(detailPalette, pageIndex * 3);
  context.fillRect(left, top, pageSize, pageSize);
  context.globalAlpha = 1;

  for (let y = 0; y < pageSize; y += 16) {
    for (let x = 0; x < pageSize; x += 16) {
      const selected = (x / 16 + y / 16 + pageIndex) % 3 === 0;
      context.fillStyle = selected
        ? paletteColor(detailPalette, pageIndex + x + y)
        : 'rgba(8, 15, 20, 0.72)';
      context.fillRect(left + x + 3, top + y + 3, 10, 10);
    }
  }

  context.strokeStyle = 'rgba(255, 241, 185, 0.72)';
  context.lineWidth = 2;
  for (let offset = -pageSize; offset <= pageSize * 2; offset += 28) {
    context.beginPath();
    context.moveTo(left + offset, top);
    context.lineTo(left + offset + pageSize, top + pageSize);
    context.stroke();
  }

  drawLabel(context, `P${pageIndex.toString().padStart(2, '0')}`, left + 22, top + 24, 28);
  context.restore();
};

export const createGeneratedTextureUri = (
  detail: SurfaceTextureDetail = 'resolved',
): string => {
  const canvas = document.createElementNS(
    'http://www.w3.org/1999/xhtml',
    'canvas',
  ) as HTMLCanvasElement;
  canvas.width = textureSize;
  canvas.height = textureSize;
  const context = canvas.getContext('2d');
  if (context === null) return '';

  context.imageSmoothingEnabled = false;
  const base = context.createLinearGradient(0, 0, textureSize, textureSize);
  base.addColorStop(0, '#07151d');
  base.addColorStop(0.5, '#123447');
  base.addColorStop(1, '#0b1825');
  context.fillStyle = base;
  context.fillRect(0, 0, textureSize, textureSize);

  for (let row = 0; row < pageCount; row += 1) {
    for (let column = 0; column < pageCount; column += 1) {
      const left = column * pageSize;
      const top = row * pageSize;

      context.globalAlpha = detail === 'coarse' ? 0.68 : 0.5;
      context.fillStyle = paletteColor(coarsePalette, column * 5 + row * 2);
      context.fillRect(left, top, pageSize, pageSize);
      context.globalAlpha = 1;

      if (detail === 'resolved') {
        drawResolvedPage(context, column, row);
      }
    }
  }

  drawLabel(
    context,
    detail === 'coarse' ? 'COARSE MIP' : 'RESOLVED PAGES',
    64,
    64,
    52,
  );
  drawGrid(context, 256, 8, 'rgba(151, 226, 229, 0.62)');

  if (detail === 'resolved') {
    drawGrid(context, 64, 2, 'rgba(255, 232, 150, 0.36)');
    drawGrid(context, 16, 1, 'rgba(255, 154, 69, 0.18)');
  }

  context.strokeStyle = '#050d13';
  context.lineWidth = 20;
  context.strokeRect(10, 10, textureSize - 20, textureSize - 20);

  return canvas.toDataURL('image/png');
};

export const createSurfaceMaterial = (
  detail: SurfaceTextureDetail = 'resolved',
): UnlitMaterial => {
  const revision = `generated-v3-${detail}`;

  return unlitMaterial({
    baseColor: virtualTextureAsset({
      colorSpace: 'srgb',
      fallback: fallbackTexture,
      id: 'generated-virtual-texturing-surface',
      manifestUri: `${import.meta.env.BASE_URL}generated-virtual-texturing-surface.vt.json`,
      // TODO(public-vt-descriptor): keep this preview until the renderer lowers
      // the virtual texture descriptor.
      preview: textureAsset({
        colorSpace: 'srgb',
        fallback: fallbackTexture,
        id: `generated-virtual-texturing-surface-preview-${detail}`,
        revision,
        sampler: surfaceSampler,
        uri: createGeneratedTextureUri(detail),
      }),
      revision,
      sampler: surfaceSampler,
    }),
  });
};
