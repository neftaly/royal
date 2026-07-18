import { describe, expect, it, vi } from "vitest";
import {
  type OrbitCameraView,
} from "@royal/react";
import {
  createOrbitCameraController,
  createOrbitControls,
} from "../../packages/react/src/orbit/controls";
import { validateUseOrbitCameraOptions } from "../../packages/react/src/orbit/camera-controller";
import { createOrbitGestureController } from "../../packages/react/src/orbit/controls-core";

type FakeEvent = Event & {
  readonly defaultPrevented: boolean;
};

type FakeCanvas = HTMLCanvasElement & {
  readonly capturedPointerIds: ReadonlySet<number>;
  dispatchFakeEvent(type: string, event: FakeEvent): void;
};

const defaultView = {
  distance: 5,
  pitch: 0.1,
  target: [0, 0, 0],
  yaw: 0.2,
} satisfies OrbitCameraView;

const fakeCanvas = (): FakeCanvas => {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const capturedPointerIds = new Set<number>();
  const canvas = {
    capturedPointerIds,
    addEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
    ) => {
      if (listener === null) return;

      const typeListeners = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
      typeListeners.add(listener);
      listeners.set(type, typeListeners);
    },
    dispatchFakeEvent: (type: string, event: FakeEvent) => {
      for (const listener of listeners.get(type) ?? []) {
        if (typeof listener === "function") {
          listener(event);
        } else {
          listener.handleEvent(event);
        }
      }
    },
    hasPointerCapture: (pointerId: number) => capturedPointerIds.has(pointerId),
    releasePointerCapture: (pointerId: number) => {
      capturedPointerIds.delete(pointerId);
    },
    removeEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
    ) => {
      if (listener === null) return;

      listeners.get(type)?.delete(listener);
    },
    setPointerCapture: (pointerId: number) => {
      capturedPointerIds.add(pointerId);
    },
  };

  return canvas as unknown as FakeCanvas;
};

const preventable = <EventShape extends object>(event: EventShape): EventShape & FakeEvent => {
  let defaultPrevented = false;

  return {
    ...event,
    get defaultPrevented() {
      return defaultPrevented;
    },
    preventDefault: () => {
      defaultPrevented = true;
    },
  } as EventShape & FakeEvent;
};

const pointerEvent = (
  pointerId: number,
  clientX: number,
  clientY: number,
  options: Partial<PointerEvent> = {},
): PointerEvent & FakeEvent => preventable({
  altKey: false,
  button: 0,
  clientX,
  clientY,
  ctrlKey: false,
  metaKey: false,
  pointerId,
  shiftKey: false,
  ...options,
}) as unknown as PointerEvent & FakeEvent;

const wheelEvent = (deltaY: number): WheelEvent & FakeEvent => preventable({
  deltaMode: 0,
  deltaY,
}) as unknown as WheelEvent & FakeEvent;

describe("OrbitControls", () => {
  it("runs gesture transitions without DOM event or canvas ownership", () => {
    const changes: OrbitCameraView[] = [];
    const core = createOrbitGestureController(defaultView, { onChange: (view) => changes.push(view) });
    expect(core.pointerDown({
      button: 0,
      clientX: 10,
      clientY: 20,
      modified: false,
      pointerId: 7,
    })).toEqual({ capture: 7, preventDefault: true });
    expect(core.pointerMove({ clientX: 30, clientY: 10, pointerId: 7 }))
      .toEqual({ preventDefault: true });
    expect(core.getView().yaw).toBeCloseTo(defaultView.yaw + 20 * 0.006);
    expect(changes).toHaveLength(1);
    expect(core.setBehavior({ enabled: false })).toEqual([7]);
    expect(core.pointerMove({ clientX: 50, clientY: 50, pointerId: 7 }))
      .toEqual({ preventDefault: false });
  });

  it("rejects malformed useOrbitCamera options before retaining hook state", () => {
    expect(() => validateUseOrbitCameraOptions(
      null as unknown as Parameters<typeof validateUseOrbitCameraOptions>[0],
    )).toThrow("useOrbitCamera options must be an object");
    expect(() => validateUseOrbitCameraOptions({
      initialView: defaultView,
    } as unknown as Parameters<typeof validateUseOrbitCameraOptions>[0]))
      .toThrow(/unsupported option.*initialView/i);
    expect(() => validateUseOrbitCameraOptions({
      initial: null,
    } as unknown as Parameters<typeof validateUseOrbitCameraOptions>[0]))
      .toThrow("useOrbitCamera initial must be an OrbitCameraViewOptions object");
  });

  it("rejects malformed behavior options before attaching interactions", () => {
    const canvas = fakeCanvas();
    expect(() => createOrbitControls(canvas, {
      initialView: defaultView,
      enabled: "yes" as unknown as boolean,
    })).toThrow("OrbitControls enabled must be a boolean");
    expect(() => createOrbitControls(canvas, {
      initialView: defaultView,
      zoomSpeed: Number.NaN,
    })).toThrow("OrbitControls zoomSpeed must be a finite number");
    expect(() => createOrbitControls(canvas, {
      initialView: defaultView,
      minDistance: 0,
    })).toThrow("OrbitControls minDistance must be positive");
    expect(() => createOrbitControls(canvas, {
      initialView: defaultView,
      maxPitch: -1,
      minPitch: 1,
    })).toThrow("OrbitControls minPitch must not exceed maxPitch");

    expect(() => createOrbitControls(canvas, {
      defaultView,
    } as unknown as Parameters<typeof createOrbitControls>[1])).toThrow(/unsupported option.*defaultView/i);

    const controls = createOrbitControls(canvas, { initialView: defaultView });
    expect(() => controls.setOptions({
      onChange: 42 as unknown as (view: OrbitCameraView) => void,
    })).toThrow("OrbitControls onChange must be a function");
    expect(() => controls.setOptions({
      enableRotation: true,
    } as unknown as Parameters<typeof controls.setOptions>[0])).toThrow(/unsupported option.*enableRotation/i);
    expect(() => controls.setView(defaultView, {
      notify: false,
    } as unknown as Parameters<typeof controls.setView>[1])).toThrow(/unsupported option.*notify/i);
    expect(() => controls.setView(defaultView, {
      emitChange: "no",
    } as unknown as Parameters<typeof controls.setView>[1])).toThrow("OrbitControls setView emitChange must be a boolean");
    controls.dispose();
  });

  it("keeps behavior unchanged when setOptions validation fails", () => {
    const canvas = fakeCanvas();
    const controls = createOrbitControls(canvas, {
      initialView: defaultView,
      minDistance: 2,
    });

    expect(() => controls.setOptions({ minDistance: -1 }))
      .toThrow("OrbitControls minDistance must be positive");
    expect(() => controls.setOptions({ maxDistance: 1 }))
      .toThrow("OrbitControls minDistance must not exceed maxDistance");

    const wheel = wheelEvent(-120);
    canvas.dispatchFakeEvent("wheel", wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(controls.getView().distance).toBeGreaterThanOrEqual(2);
    controls.dispose();
  });

  it("publishes explicit camera resource commits without a reactive view getter", () => {
    const orbit = createOrbitCameraController({ distance: 5 }, { far: 100, fovY: 1, near: 0.1 });
    const listener = vi.fn();
    orbit.subscribeView(listener);
    const version = orbit.cameraResource.version;

    orbit.setView({ distance: 6, pitch: 0.2, target: [1, 2, 3], yaw: 0.3 });
    expect(orbit.cameraResource.version).toBe(version + 1);
    expect(orbit.getView()).toEqual({ distance: 6, pitch: 0.2, target: [1, 2, 3], yaw: 0.3 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(orbit).not.toHaveProperty("view");

    orbit.setView(orbit.getView());
    expect(orbit.cameraResource.version).toBe(version + 1);
    expect(listener).toHaveBeenCalledTimes(1);

    expect(() => orbit.subscribeView(
      null as unknown as () => void,
    )).toThrow("Orbit camera subscribeView listener must be a function");
    expect(() => orbit.setProjection({
      far: 0,
      fovY: 1,
      near: 0.1,
    })).toThrow("Orbit camera projection requires 0 < near < far");
    expect(() => orbit.setProjection({
      far: 100,
      fieldOfView: 1,
      fovY: 1,
      near: 0.1,
    } as unknown as Parameters<typeof orbit.setProjection>[0]))
      .toThrow(/unsupported field.*fieldOfView/i);
    expect(orbit.cameraResource).toMatchObject({ far: 100, fovY: 1, near: 0.1 });
    expect(orbit.getProjection()).toEqual({ far: 100, fovY: 1, near: 0.1 });

    orbit.setProjection(orbit.getProjection());
    expect(orbit.cameraResource.version).toBe(version + 1);

    orbit.setProjection({ far: 200, fovY: 0.8, near: 0.01 });
    expect(orbit.cameraResource).toMatchObject({ far: 200, fovY: 0.8, near: 0.01 });
    expect(orbit.getProjection()).toEqual({ far: 200, fovY: 0.8, near: 0.01 });

    orbit.fit({ min: [-2, -1, -4], max: [2, 3, 4] }, {
      aspectRatio: 2,
      padding: 1.1,
      pitch: 0.4,
      yaw: 0.5,
    });
    expect(orbit.getView()).toMatchObject({
      pitch: 0.4,
      target: [0, 1, 0],
      yaw: 0.5,
    });
    expect(orbit.getView().distance).toBeGreaterThan(8);
  });

  it("expands fitted clipping once without sacrificing the authored near plane", () => {
    const orbit = createOrbitCameraController(
      { distance: 1 },
      { far: 2_000, fovY: Math.PI / 4, near: 0.02 },
    );
    const listener = vi.fn();
    orbit.subscribeView(listener);
    const version = orbit.cameraResource.version;

    orbit.fit({
      max: [6_956, 2_721, 6_030],
      min: [-3_904, -473, -5_497],
    }, {
      aspectRatio: 16 / 9,
      padding: 1.08,
      pitch: 0.28,
      yaw: 0.7,
    });

    expect(orbit.getProjection().far).toBeGreaterThan(20_000);
    expect(orbit.getProjection().near).toBe(0.02);
    expect(orbit.cameraResource).toMatchObject({
      far: orbit.getProjection().far,
      near: 0.02,
    });
    expect(orbit.cameraResource.version).toBe(version + 1);
    expect(listener).toHaveBeenCalledTimes(1);

    orbit.fit({
      max: [6_956, 2_721, 6_030],
      min: [-3_904, -473, -5_497],
    }, {
      aspectRatio: 16 / 9,
      padding: 1.08,
      pitch: 0.28,
      yaw: 0.7,
    });
    expect(orbit.cameraResource.version).toBe(version + 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("zooms in and out from wheel input", () => {
    const canvas = fakeCanvas();
    const changes: OrbitCameraView[] = [];
    const controls = createOrbitControls(canvas, {
      initialView: defaultView,
      onChange: (view) => changes.push(view),
    });

    controls.setView(defaultView, { emitChange: false });
    const zoomIn = wheelEvent(-120);
    const zoomOut = wheelEvent(120);

    canvas.dispatchFakeEvent("wheel", zoomIn);
    expect(zoomIn.defaultPrevented).toBe(true);
    expect(controls.getView().distance).toBeLessThan(defaultView.distance);

    canvas.dispatchFakeEvent("wheel", zoomOut);
    expect(zoomOut.defaultPrevented).toBe(true);
    expect(controls.getView().distance).toBeCloseTo(defaultView.distance);
    expect(changes).toHaveLength(2);

    controls.dispose();
  });

  it("zooms from a two-pointer pinch without changing orbit angles", () => {
    const canvas = fakeCanvas();
    const changes: OrbitCameraView[] = [];
    const controls = createOrbitControls(canvas, {
      initialView: defaultView,
      onChange: (view) => changes.push(view),
    });

    canvas.dispatchFakeEvent("pointerdown", pointerEvent(1, 0, 0));
    canvas.dispatchFakeEvent("pointerdown", pointerEvent(2, 100, 0));
    canvas.dispatchFakeEvent("pointermove", pointerEvent(2, 150, 0));

    expect(controls.getView()).toMatchObject({
      pitch: defaultView.pitch,
      target: defaultView.target,
      yaw: defaultView.yaw,
    });
    expect(controls.getView().distance).toBeLessThan(defaultView.distance);
    expect(changes).toHaveLength(1);

    controls.dispose();
  });

  it("preserves single-pointer orbit rotation", () => {
    const canvas = fakeCanvas();
    const controls = createOrbitControls(canvas, { initialView: defaultView });

    canvas.dispatchFakeEvent("pointerdown", pointerEvent(1, 10, 20));
    canvas.dispatchFakeEvent("pointermove", pointerEvent(1, 20, 15));

    expect(controls.getView()).toMatchObject({
      distance: defaultView.distance,
      target: defaultView.target,
    });
    expect(controls.getView().pitch).toBeCloseTo(defaultView.pitch - 5 * 0.006);
    expect(controls.getView().yaw).toBeCloseTo(defaultView.yaw + 10 * 0.006);

    controls.dispose();
  });

  it("does not compete with pointer and wheel events consumed by scene handlers", () => {
    const canvas = fakeCanvas();
    const onChange = vi.fn();
    const controls = createOrbitControls(canvas, { initialView: defaultView, onChange });
    const consumedDown = pointerEvent(1, 10, 20);
    const consumedWheel = wheelEvent(-120);
    consumedDown.preventDefault();
    consumedWheel.preventDefault();

    canvas.dispatchFakeEvent("pointerdown", consumedDown);
    canvas.dispatchFakeEvent("pointermove", pointerEvent(1, 30, 40));
    canvas.dispatchFakeEvent("wheel", consumedWheel);

    expect(canvas.capturedPointerIds.size).toBe(0);
    expect(controls.getView()).toEqual(defaultView);
    expect(onChange).not.toHaveBeenCalled();

    controls.dispose();
  });

  it("clamps the initial view and skips unchanged notifications", () => {
    const canvas = fakeCanvas();
    const onChange = vi.fn();
    const controls = createOrbitControls(canvas, {
      initialView: { ...defaultView, distance: 1 },
      minDistance: 3,
      onChange,
    });

    expect(controls.getView().distance).toBe(3);
    controls.setView(controls.getView());
    expect(onChange).not.toHaveBeenCalled();

    controls.dispose();
  });

  it("cancels an active gesture when controls are disabled", () => {
    const canvas = fakeCanvas();
    const controls = createOrbitControls(canvas, { initialView: defaultView });

    canvas.dispatchFakeEvent("pointerdown", pointerEvent(1, 10, 20));
    expect(canvas.capturedPointerIds.has(1)).toBe(true);

    controls.setOptions({ enabled: false });
    canvas.dispatchFakeEvent("pointermove", pointerEvent(1, 30, 40));

    expect(canvas.capturedPointerIds.has(1)).toBe(false);
    expect(controls.getView()).toEqual(defaultView);

    controls.dispose();
  });
});
