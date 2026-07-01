import { describe, expect, it, vi } from 'vitest';
import {
  createOrbitControls,
  orbitCameraTransform,
  type OrbitCameraView,
} from '../src/orbit-controls';

const defaultView = {
  distance: 5,
  pitch: 0,
  target: [0, 0, 0],
  yaw: 0,
} satisfies OrbitCameraView;

const expectVectorCloseTo = (
  actual: readonly number[],
  expected: readonly number[],
): void => {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => {
    expect(actual[index]).toBeCloseTo(value);
  });
};

const canvasWithListeners = (): {
  readonly canvas: HTMLCanvasElement;
  readonly listeners: Map<string, Set<EventListenerOrEventListenerObject>>;
} => {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const addEventListener = vi.fn((
    type: string,
    listener: EventListenerOrEventListenerObject,
  ) => {
    const bucket = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
    bucket.add(listener);
    listeners.set(type, bucket);
  });
  const removeEventListener = vi.fn((
    type: string,
    listener: EventListenerOrEventListenerObject,
  ) => {
    listeners.get(type)?.delete(listener);
  });

  return {
    canvas: {
      addEventListener,
      hasPointerCapture: vi.fn(() => false),
      releasePointerCapture: vi.fn(),
      removeEventListener,
      setPointerCapture: vi.fn(),
    } as unknown as HTMLCanvasElement,
    listeners,
  };
};

describe('orbit controls', () => {
  it('converts an orbit view into a camera transform', () => {
    expect(orbitCameraTransform(defaultView)).toEqual({
      position: [0, 0, 5],
      rotation: [-0, -0, 0],
    });

    const transform = orbitCameraTransform({
      distance: 2,
      pitch: Math.PI / 6,
      target: [1, 2, 3],
      yaw: Math.PI / 2,
    });

    expectVectorCloseTo(transform.position, [-0.7320508075688774, 3, 3]);
    expectVectorCloseTo(transform.rotation, [-Math.PI / 6, -Math.PI / 2, 0]);
  });

  it('registers and disposes canvas listeners', () => {
    const { canvas, listeners } = canvasWithListeners();
    const controls = createOrbitControls(canvas, {
      initialView: defaultView,
      onChange: vi.fn(),
    });

    expect([...listeners.keys()].sort()).toEqual([
      'contextmenu',
      'pointercancel',
      'pointerdown',
      'pointermove',
      'pointerup',
      'wheel',
    ]);

    controls.dispose();

    expect([...listeners.values()].every((bucket) => bucket.size === 0)).toBe(true);
  });
});
