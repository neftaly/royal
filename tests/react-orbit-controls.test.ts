import { describe, expect, it } from "vitest";
import {
  createOrbitCameraStore,
  createOrbitControls,
  orbitCameraTransform,
  orbitPerspectiveCamera,
  resolveOrbitCameraView,
  updateOrbitPerspectiveCamera,
  type OrbitCameraView,
} from "@royal/react";

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
  it("defaults sparse orbit views to origin target and zero yaw", () => {
    expect(resolveOrbitCameraView({
      distance: 5,
      pitch: 0,
    })).toEqual({
      distance: 5,
      pitch: 0,
      target: [0, 0, 0],
      yaw: 0,
    });

    expect(orbitCameraTransform({
      distance: 5,
      pitch: 0,
    })).toEqual({
      position: [0, 0, 5],
      rotation: [-0, -0, 0],
    });
  });

  it("publishes complete views from orbit camera stores", () => {
    const store = createOrbitCameraStore({
      distance: 5,
      pitch: 0.1,
    });
    const changes: OrbitCameraView[] = [];
    const unsubscribe = store.subscribe((state) => {
      changes.push(state.view);
    });

    expect(store.getState().view).toEqual({
      distance: 5,
      pitch: 0.1,
      target: [0, 0, 0],
      yaw: 0,
    });

    store.getState().setView({
      distance: 6,
      pitch: 0.2,
      target: [1, 2, 3],
      yaw: 0.3,
    });
    unsubscribe();
    store.getState().setView({
      distance: 7,
      pitch: 0.4,
    });

    expect(changes).toEqual([
      {
        distance: 6,
        pitch: 0.2,
        target: [1, 2, 3],
        yaw: 0.3,
      },
    ]);
  });

  it("updates stable perspective camera descriptors for imperative camera paths", () => {
    const camera = orbitPerspectiveCamera({
      far: 10,
      fovY: Math.PI / 3,
      near: 0.1,
      view: defaultView,
    });
    const originalCamera = camera;
    const expected = orbitPerspectiveCamera({
      far: 20,
      fovY: Math.PI / 4,
      near: 0.2,
      view: {
        distance: 6,
        pitch: -0.2,
        target: [1, 2, 3],
        yaw: 0.4,
      },
    });

    updateOrbitPerspectiveCamera(camera, {
      far: 20,
      fovY: Math.PI / 4,
      near: 0.2,
      view: {
        distance: 6,
        pitch: -0.2,
        target: [1, 2, 3],
        yaw: 0.4,
      },
    });

    expect(camera).toBe(originalCamera);
    expect(camera).toEqual(expected);
  });

  it("zooms in and out from wheel input", () => {
    const canvas = fakeCanvas();
    const changes: OrbitCameraView[] = [];
    const controls = createOrbitControls(canvas, {
      defaultView,
      onChange: (view) => changes.push(view),
    });

    controls.setView(defaultView, { notify: false });
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
      defaultView,
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
    const controls = createOrbitControls(canvas, { defaultView });

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
});
