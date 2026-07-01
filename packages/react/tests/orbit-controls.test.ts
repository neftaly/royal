import { describe, expect, it, vi } from 'vitest';
import {
  createOrbitControls,
  orbitCameraTransform,
  orbitPerspectiveCamera,
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
  readonly setPointerCapture: ReturnType<typeof vi.fn<(pointerId: number) => void>>;
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
  const setPointerCapture = vi.fn();

  return {
    canvas: {
      addEventListener,
      hasPointerCapture: vi.fn(() => false),
      releasePointerCapture: vi.fn(),
      removeEventListener,
      setPointerCapture,
    } as unknown as HTMLCanvasElement,
    listeners,
    setPointerCapture,
  };
};

const emitCanvasEvent = (
  listeners: Map<string, Set<EventListenerOrEventListenerObject>>,
  type: string,
  event: Record<string, unknown>,
): void => {
  const canvasEvent = event as unknown as Event;

  for (const listener of listeners.get(type) ?? []) {
    if (typeof listener === 'function') {
      listener(canvasEvent);
    } else {
      listener.handleEvent(canvasEvent);
    }
  }
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

  it('creates perspective cameras from orbit views', () => {
    expect(orbitPerspectiveCamera({
      far: 100,
      fovY: Math.PI / 4,
      near: 0.1,
      view: defaultView,
    })).toEqual({
      far: 100,
      fovY: Math.PI / 4,
      kind: 'perspective-camera',
      near: 0.1,
      position: [0, 0, 5],
      rotation: [-0, -0, 0],
    });
  });

  it('registers and disposes canvas listeners', () => {
    const { canvas, listeners } = canvasWithListeners();
    const controls = createOrbitControls(canvas, {
      defaultView,
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

  it('accepts defaultView and optional change handlers', () => {
    const { canvas } = canvasWithListeners();
    const controls = createOrbitControls(canvas, {
      defaultView,
    });

    expect(controls.getView()).toBe(defaultView);
    expect(() => controls.setView({ ...defaultView, distance: 6 })).not.toThrow();
    expect(controls.getView().distance).toBe(6);
  });

  it('clamps imperative view updates', () => {
    const { canvas } = canvasWithListeners();
    const onChange = vi.fn();
    const controls = createOrbitControls(canvas, {
      defaultView,
      maxDistance: 7,
      maxPitch: 0.5,
      minDistance: 3,
      minPitch: -0.5,
      onChange,
    });

    controls.setView({
      ...defaultView,
      distance: 20,
      pitch: 2,
    });

    expect(controls.getView()).toMatchObject({
      distance: 7,
      pitch: 0.5,
    });
    expect(onChange).toHaveBeenLastCalledWith(controls.getView());
  });

  it('can sync controlled views without firing change handlers', () => {
    const { canvas } = canvasWithListeners();
    const onChange = vi.fn();
    const controls = createOrbitControls(canvas, {
      defaultView,
      onChange,
    });

    controls.setView({ ...defaultView, distance: 8 }, { notify: false });

    expect(controls.getView().distance).toBe(8);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('updates behavior options without resetting the current view', () => {
    const { canvas, listeners, setPointerCapture } = canvasWithListeners();
    const firstChange = vi.fn();
    const nextChange = vi.fn();
    const controls = createOrbitControls(canvas, {
      defaultView,
      onChange: firstChange,
    });

    controls.setView({ ...defaultView, distance: 8 });
    controls.setOptions({
      enabled: false,
      onChange: nextChange,
    });

    emitCanvasEvent(listeners, 'pointerdown', {
      altKey: false,
      button: 0,
      clientX: 10,
      clientY: 20,
      ctrlKey: false,
      metaKey: false,
      pointerId: 1,
      preventDefault: vi.fn(),
      shiftKey: false,
    });
    controls.setView({ ...defaultView, distance: 9 });

    expect(controls.getView().distance).toBe(9);
    expect(setPointerCapture).not.toHaveBeenCalled();
    expect(firstChange).toHaveBeenCalledTimes(1);
    expect(nextChange).toHaveBeenCalledTimes(1);
  });

  it('can disable pointer and wheel controls', () => {
    const { canvas, listeners, setPointerCapture } = canvasWithListeners();
    const preventDefault = vi.fn();
    createOrbitControls(canvas, {
      defaultView,
      enabled: false,
      onChange: vi.fn(),
    });

    emitCanvasEvent(listeners, 'pointerdown', {
      altKey: false,
      button: 0,
      clientX: 10,
      clientY: 20,
      ctrlKey: false,
      metaKey: false,
      pointerId: 1,
      preventDefault,
      shiftKey: false,
    });
    emitCanvasEvent(listeners, 'wheel', {
      deltaMode: 0,
      deltaY: 120,
      preventDefault,
    });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(setPointerCapture).not.toHaveBeenCalled();
  });
});
