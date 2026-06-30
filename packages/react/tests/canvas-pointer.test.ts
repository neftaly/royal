import { describe, expect, it, vi } from 'vitest';
import {
  captureCanvasPointer,
  releaseCanvasPointer,
} from '../src/canvas-pointer';

const canvasWithPointerCapture = (
  methods: Pick<HTMLCanvasElement, 'hasPointerCapture' | 'releasePointerCapture' | 'setPointerCapture'>,
): HTMLCanvasElement => methods as HTMLCanvasElement;

describe('canvas pointer helpers', () => {
  it('captures an active pointer', () => {
    const setPointerCapture = vi.fn();
    const canvas = canvasWithPointerCapture({
      hasPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      setPointerCapture,
    });

    captureCanvasPointer(canvas, 12);

    expect(setPointerCapture).toHaveBeenCalledWith(12);
  });

  it('ignores pointer capture failures', () => {
    const canvas = canvasWithPointerCapture({
      hasPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      setPointerCapture: vi.fn(() => {
        throw new Error('inactive pointer');
      }),
    });

    expect(() => captureCanvasPointer(canvas, 12)).not.toThrow();
  });

  it('releases a captured pointer', () => {
    const hasPointerCapture = vi.fn(() => true);
    const releasePointerCapture = vi.fn();
    const canvas = canvasWithPointerCapture({
      hasPointerCapture,
      releasePointerCapture,
      setPointerCapture: vi.fn(),
    });

    releaseCanvasPointer(canvas, 34);

    expect(hasPointerCapture).toHaveBeenCalledWith(34);
    expect(releasePointerCapture).toHaveBeenCalledWith(34);
  });

  it('does not release a pointer that is not captured', () => {
    const hasPointerCapture = vi.fn(() => false);
    const releasePointerCapture = vi.fn();
    const canvas = canvasWithPointerCapture({
      hasPointerCapture,
      releasePointerCapture,
      setPointerCapture: vi.fn(),
    });

    releaseCanvasPointer(canvas, 34);

    expect(hasPointerCapture).toHaveBeenCalledWith(34);
    expect(releasePointerCapture).not.toHaveBeenCalled();
  });

  it('ignores pointer release failures', () => {
    const canvas = canvasWithPointerCapture({
      hasPointerCapture: vi.fn(() => {
        throw new Error('inactive pointer');
      }),
      releasePointerCapture: vi.fn(),
      setPointerCapture: vi.fn(),
    });

    expect(() => releaseCanvasPointer(canvas, 34)).not.toThrow();
  });
});
