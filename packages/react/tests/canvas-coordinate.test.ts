import { describe, expect, it } from 'vitest';
import {
  canvasPointToWorld,
  type CanvasWorldBounds,
  worldPointToCanvasClient,
} from '../src/canvas-coordinate';

const bounds: CanvasWorldBounds = {
  bottom: -3,
  left: -5,
  right: 7,
  top: 9,
};

const canvasWithRect = (
  rect: Pick<DOMRect, 'height' | 'left' | 'top' | 'width'>,
): HTMLCanvasElement =>
  ({
    getBoundingClientRect: () => rect,
  }) as HTMLCanvasElement;

describe('canvas coordinate helpers', () => {
  it('maps canvas client points into world coordinates', () => {
    const canvas = canvasWithRect({ height: 300, left: 20, top: 10, width: 600 });

    expect(canvasPointToWorld(canvas, bounds, 20, 10)).toEqual([-5, 9]);
    expect(canvasPointToWorld(canvas, bounds, 620, 310)).toEqual([7, -3]);
    expect(canvasPointToWorld(canvas, bounds, 320, 160)).toEqual([1, 3]);
  });

  it('maps world coordinates into canvas client points', () => {
    const canvas = canvasWithRect({ height: 300, left: 20, top: 10, width: 600 });

    expect(worldPointToCanvasClient(canvas, bounds, -5, 9)).toEqual([20, 10]);
    expect(worldPointToCanvasClient(canvas, bounds, 7, -3)).toEqual([620, 310]);
    expect(worldPointToCanvasClient(canvas, bounds, 1, 3)).toEqual([320, 160]);
  });

  it('round-trips points through both coordinate spaces', () => {
    const canvas = canvasWithRect({ height: 50, left: -12, top: 4, width: 250 });

    const world = canvasPointToWorld(canvas, bounds, 38, 29);
    const client = worldPointToCanvasClient(canvas, bounds, world[0], world[1]);
    expect(client[0]).toBeCloseTo(38);
    expect(client[1]).toBeCloseTo(29);
  });

  it('uses the world top-left when the canvas has no drawable client size', () => {
    const canvas = canvasWithRect({ height: 0, left: 20, top: 10, width: 0 });

    expect(canvasPointToWorld(canvas, bounds, 320, 160)).toEqual([-5, 9]);
  });
});
