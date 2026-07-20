import { describe, expect, it } from 'vitest';

import { summarizeCanvasPixels } from './canvas-sample.mjs';

describe('browser canvas sampling', () => {
  it('does not mistake an opaque clear-only canvas for rendered content', () => {
    const pixels = new Uint8ClampedArray([
      1, 1, 3, 255,
      1, 1, 3, 255,
      1, 1, 3, 255,
      1, 1, 3, 255,
    ]);

    expect(summarizeCanvasPixels(pixels, 2, 2)).toMatchObject({
      backgroundPixels: 4,
      colorBuckets: 0,
      paintedPixels: 0,
      paintedRatio: 0,
    });
  });

  it('measures content against the dominant opaque clear color', () => {
    const pixels = new Uint8ClampedArray([
      1, 1, 3, 255,
      1, 1, 3, 255,
      240, 32, 16, 255,
      1, 1, 3, 255,
    ]);

    expect(summarizeCanvasPixels(pixels, 2, 2)).toMatchObject({
      backgroundPixels: 3,
      colorBuckets: 1,
      paintedPixels: 1,
      paintedRatio: 0.25,
    });
  });

  it('retains alpha-based sampling for transparent canvases', () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 0,
      240, 32, 16, 255,
      240, 32, 16, 255,
      0, 0, 0, 0,
    ]);

    expect(summarizeCanvasPixels(pixels, 2, 2)).toMatchObject({
      backgroundPixels: 0,
      colorBuckets: 1,
      paintedPixels: 2,
      paintedRatio: 0.5,
    });
  });
});
