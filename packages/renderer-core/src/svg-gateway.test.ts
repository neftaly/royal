import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { SvgGatewayInput } from './svg-gateway';
import {
  createSvgGatewayGeometry,
  createSvgRasterTextureSource,
  roundedRectToContour,
  svgPathToContours,
  triangulateSvgGatewayContours
} from './svg-gateway';

const starPoints = [
  [128, 20],
  [153.9, 92.4],
  [230.7, 94.6],
  [169.8, 141.6],
  [191.5, 215.4],
  [128, 172],
  [64.5, 215.4],
  [86.2, 141.6],
  [25.3, 94.6],
  [102.1, 92.4]
] as const;

const roundedRectPath = 'M 10 0 H 90 A 10 10 0 0 1 100 10 V 50 A 10 10 0 0 1 90 60 H 10 A 10 10 0 0 1 0 50 V 10 A 10 10 0 0 1 10 0 Z';

describe('SVG gateway geometry and picking', () => {
  it('uses concave polygon edges for star picking instead of the texture rectangle', () => {
    const geometry = createSvgGatewayGeometry({ kind: 'polygon', id: 'star', points: starPoints });

    expect(geometry.kind).toBe('svg-gateway-geometry');
    expect(geometry.bounds).toMatchObject({ minX: 25.3, maxX: 230.7, minY: 20, maxY: 215.4 });
    expect(geometry.mesh.indices.length).toBeGreaterThan(0);
    expect(geometry.hitRegion.contains([128, 128])).toBe(true);
    expect(geometry.hitRegion.contains([128, 20])).toBe(true);
    expect(geometry.hitRegion.contains([187, 130])).toBe(false);
    expect(geometry.hitRegion.contains([60, 136])).toBe(false);
    expect(geometry.hitRegion.contains([10, 10])).toBe(false);
  });

  it('keeps rounded rect corners out of the hit region', () => {
    const geometry = createSvgGatewayGeometry({
      height: 60,
      kind: 'rect',
      rx: 12,
      width: 100
    });

    expect(geometry.contours[0]?.points.length).toBeGreaterThan(8);
    expect(geometry.hitRegion.contains([50, 30])).toBe(true);
    expect(geometry.hitRegion.contains([12, 0])).toBe(true);
    expect(geometry.hitRegion.contains([2, 2])).toBe(false);
    expect(geometry.hitRegion.contains([98, 2])).toBe(false);
  });

  it('flattens SVG arc path data into the same rounded corner picking geometry', () => {
    const geometry = createSvgGatewayGeometry({ d: roundedRectPath, id: 'rounded-card-path', kind: 'path' });

    expect(geometry.contours).toHaveLength(1);
    expect(geometry.contours[0]?.points.length).toBeGreaterThan(8);
    expect(geometry.hitRegion.contains([50, 30])).toBe(true);
    expect(geometry.hitRegion.contains([3, 3])).toBe(false);
  });

  it('ingests filled SVG polygon markup while ignoring raster-only transparent bounds', () => {
    const svg = `<svg viewBox="0 0 256 256">
      <rect width="256" height="256" fill="none" />
      <polygon id="star" points="128,20 153.9,92.4 230.7,94.6 169.8,141.6 191.5,215.4 128,172 64.5,215.4 86.2,141.6 25.3,94.6 102.1,92.4" fill="#f5b83f" />
      <polygon id="highlight" points="128,38 148.4,98 211.4,99.6 161.4,138.2 179.7,198.7 128,163.5 76.3,198.7 94.6,138.2 44.6,99.6 107.6,98" fill="none" stroke="#fff7c9" />
    </svg>`;
    const geometry = createSvgGatewayGeometry({ kind: 'svg', svg });

    expect(geometry.diagnostics).toHaveLength(0);
    expect(geometry.contours.map((contour) => contour.id)).toEqual(['star']);
    expect(geometry.hitRegion.contains([128, 128])).toBe(true);
    expect(geometry.hitRegion.contains([60, 136])).toBe(false);
  });

  it('reports stable SVG extraction diagnostics exactly', () => {
    const svg = `<svg viewBox="0 0 20 20">
      <path id="shifted" transform="translate(4 4)" d="M0 0 L10 0 L0 10 Z" />
      <polyline id="guide" points="0,0 10,10 20,0" fill="#111" />
    </svg>`;
    const geometry = createSvgGatewayGeometry({ kind: 'svg', svg });

    expect(geometry.diagnostics).toEqual([
      'path#shifted has transform; SVG gateway uses untransformed geometry.',
      'polyline#guide skipped: open strokes are not SVG gateway fill geometry.'
    ]);
  });

  it('supports holes for picking and triangulation', () => {
    const geometry = createSvgGatewayGeometry({
      fillRule: 'nonzero',
      kind: 'contours',
      contours: [
        { id: 'outer', points: [[0, 0], [100, 0], [100, 100], [0, 100]] },
        { id: 'hole', points: [[35, 35], [65, 35], [65, 65], [35, 65]], role: 'hole' }
      ]
    });

    expect(geometry.hitRegion.contains([20, 20])).toBe(true);
    expect(geometry.hitRegion.contains([50, 50])).toBe(false);
    expect(geometry.mesh.contourRanges.map((range) => [range.id, range.role])).toEqual([
      ['outer', 'solid'],
      ['hole', 'hole']
    ]);
    expect(geometry.mesh.indices.length).toBeGreaterThan(6);
  });

  it('exposes focused helpers for path, rect, triangulation, and browser raster boundaries', () => {
    const pathContours = svgPathToContours('M0 0 L40 0 L20 40 Z');
    const rounded = roundedRectToContour({ height: 10, kind: 'rect', rx: 2, width: 20 });
    const mesh = triangulateSvgGatewayContours([...pathContours, rounded]);
    const texture = createSvgRasterTextureSource({ height: 256, id: 'star-texture', svg: '<svg />', width: 256 });

    expect(pathContours).toHaveLength(1);
    expect(rounded.points.length).toBeGreaterThan(4);
    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(texture.cacheKey).toBe('svg-raster-texture:star-texture:256x256');
  });

  it('rejects open contour input instead of ignoring the closed flag', () => {
    const input = {
      kind: 'contours',
      contours: [
        { closed: false, id: 'open', points: [[0, 0], [10, 0], [0, 10]] }
      ]
    } as unknown as SvgGatewayInput;

    expect(() => createSvgGatewayGeometry(input)).toThrow('SVG gateway contours must be closed fill geometry.');
  });

  it('rejects non-finite contour coordinates', () => {
    expect(() => createSvgGatewayGeometry({
      kind: 'polygon',
      id: 'bad-point',
      points: [[0, 0], [Number.POSITIVE_INFINITY, 0], [0, 10]]
    })).toThrow('contour bad-point point 1 must contain finite x and y coordinates.');
  });

  it('keeps repeated point-in-shape checks in the microsecond-per-pointer range', () => {
    const geometry = createSvgGatewayGeometry({ kind: 'polygon', points: starPoints });
    let hits = 0;
    const started = performance.now();

    for (let index = 0; index < 20_000; index += 1) {
      const x = geometry.bounds.minX + ((index * 37) % Math.ceil(geometry.bounds.width));
      const y = geometry.bounds.minY + ((index * 53) % Math.ceil(geometry.bounds.height));
      if (geometry.hitRegion.contains([x, y])) hits += 1;
    }

    const elapsedMs = performance.now() - started;
    expect(hits).toBeGreaterThan(1_000);
    expect(elapsedMs).toBeLessThan(1_000);
  });
});
