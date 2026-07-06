import {
  clampOrbitCameraView,
  orbitPerspectiveCamera,
  panOrbitCameraView,
  resolveOrbitCameraView,
  rotateOrbitCameraView,
  zoomOrbitCameraView,
  type PerspectiveCamera,
  type OrbitCameraView,
  type OrbitCameraViewOptions,
  type OrbitPerspectiveCameraOptions,
} from "@royal/renderer-core";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useStore } from "zustand/react";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useCanvasElement, useInvalidate } from "./canvas";
import { captureCanvasPointer, releaseCanvasPointer } from "./canvas-pointer";

export {
  orbitCameraTransform,
  orbitPerspectiveCamera,
  resolveOrbitCameraView,
} from "@royal/renderer-core";
export type {
  OrbitCameraTransform,
  OrbitCameraView,
  OrbitCameraViewOptions,
  OrbitPerspectiveCameraOptions,
  OrbitVector3,
} from "@royal/renderer-core";

export type OrbitCameraState = {
  readonly setView: (view: OrbitCameraViewOptions) => void;
  readonly view: OrbitCameraView;
};

export type OrbitCameraStore = StoreApi<OrbitCameraState>;

export type OrbitControlsBehaviorOptions = {
  readonly enabled?: boolean | undefined;
  readonly enablePan?: boolean | undefined;
  readonly enableRotate?: boolean | undefined;
  readonly enableZoom?: boolean | undefined;
  readonly maxDistance?: number | undefined;
  readonly maxPitch?: number | undefined;
  readonly minDistance?: number | undefined;
  readonly minPitch?: number | undefined;
  readonly onChange?: ((view: OrbitCameraView) => void) | undefined;
  readonly panSpeed?: number | undefined;
  readonly rotateSpeed?: number | undefined;
  readonly zoomSpeed?: number | undefined;
};

export type OrbitControlsHandle = {
  dispose(): void;
  getView(): OrbitCameraView;
  setOptions(options: OrbitControlsBehaviorOptions): void;
  setView(
    view: OrbitCameraViewOptions,
    options?: { readonly clamp?: boolean | undefined; readonly notify?: boolean | undefined }
  ): void;
};

export type OrbitControlsOptions = {
  readonly defaultView?: OrbitCameraViewOptions;
  readonly value?: OrbitCameraViewOptions;
} & OrbitControlsBehaviorOptions;

export type OrbitControlsProps = OrbitControlsOptions & {
  readonly camera?: PerspectiveCamera | undefined;
  readonly far?: number | undefined;
  readonly fovY?: number | undefined;
  readonly near?: number | undefined;
  readonly store?: OrbitCameraStore | undefined;
};

type OrbitControlsViewInputs = {
  readonly defaultView?: OrbitCameraViewOptions | undefined;
  readonly value?: OrbitCameraViewOptions | undefined;
};

type OrbitCameraSyncOptions = {
  readonly camera: PerspectiveCamera;
  readonly far: number;
  readonly fovY: number;
  readonly near: number;
  readonly store: OrbitCameraStore;
};

type DragMode = "orbit" | "pan";

type DragState = {
  readonly kind: "drag";
  readonly mode: DragMode;
  readonly pointerId: number;
  readonly startView: OrbitCameraView;
  readonly startX: number;
  readonly startY: number;
};

type PinchState = {
  readonly kind: "pinch";
  readonly pointerIds: readonly [number, number];
  readonly startDistance: number;
  readonly startView: OrbitCameraView;
};

type InteractionState = DragState | PinchState;

type PointerContact = {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
};

const defaultPanSpeed = 0.0016;
const defaultRotateSpeed = 0.006;
const defaultZoomSpeed = 0.0018;

export const createOrbitCameraStore = (initialView: OrbitCameraViewOptions): OrbitCameraStore =>
  createStore<OrbitCameraState>()((set) => ({
    setView: (nextView) => {
      set({ view: resolveOrbitCameraView(nextView) });
    },
    view: resolveOrbitCameraView(initialView),
  }));

const resolveStartingView = (options: OrbitControlsViewInputs): OrbitCameraView => {
  const view = options.value ?? options.defaultView;
  if (view === undefined) {
    throw new Error("OrbitControls expects value or defaultView");
  }

  return resolveOrbitCameraView(view);
};

const toBehaviorOptions = ({
  enabled,
  enablePan,
  enableRotate,
  enableZoom,
  maxDistance,
  maxPitch,
  minDistance,
  minPitch,
  onChange,
  panSpeed,
  rotateSpeed,
  zoomSpeed,
}: OrbitControlsBehaviorOptions): OrbitControlsBehaviorOptions => ({
  enabled,
  enablePan,
  enableRotate,
  enableZoom,
  maxDistance,
  maxPitch,
  minDistance,
  minPitch,
  onChange,
  panSpeed,
  rotateSpeed,
  zoomSpeed,
});

const wheelDeltaPixels = (event: WheelEvent): number => {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * Math.max(1, globalThis.innerHeight || 800);
  return event.deltaY;
};

const toPointerContact = (event: PointerEvent): PointerContact => ({
  clientX: event.clientX,
  clientY: event.clientY,
  pointerId: event.pointerId,
});

const pointerDistance = (first: PointerContact, second: PointerContact): number =>
  Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);

const syncOrbitPerspectiveCameraDescriptor = (
  camera: PerspectiveCamera,
  options: OrbitPerspectiveCameraOptions,
): void => {
  const nextCamera = orbitPerspectiveCamera(options);
  const mutableCamera = camera as MutablePerspectiveCamera;
  mutableCamera.position = nextCamera.position;
  mutableCamera.rotation = nextCamera.rotation;
  mutableCamera.fovY = nextCamera.fovY;
  mutableCamera.near = nextCamera.near;
  mutableCamera.far = nextCamera.far;
};

export const useOrbitCameraView = (store: OrbitCameraStore): OrbitCameraView =>
  useStore(store, (state) => state.view);

export type UseOrbitCameraOptions =
  OrbitCameraViewOptions &
  Partial<Omit<OrbitPerspectiveCameraOptions, "view">> & {
    readonly store?: OrbitCameraStore | undefined;
  };

export type OrbitCameraHookResult = {
  readonly camera: PerspectiveCamera;
  readonly getView: () => OrbitCameraView;
  readonly orbitControlsProps: Pick<OrbitControlsProps, "camera" | "far" | "fovY" | "near" | "store">;
  readonly setView: OrbitCameraState["setView"];
  readonly store: OrbitCameraStore;
  readonly view: OrbitCameraView;
};

type MutablePerspectiveCamera = {
  -readonly [Key in keyof PerspectiveCamera]: PerspectiveCamera[Key];
};

export const useOrbitCamera = ({
  distance,
  far = 100,
  fovY = Math.PI / 4,
  near = 0.1,
  pitch,
  store,
  target,
  yaw,
}: UseOrbitCameraOptions): OrbitCameraHookResult => {
  const defaultStoreRef = useRef<OrbitCameraStore | undefined>(undefined);
  if (defaultStoreRef.current === undefined) {
    defaultStoreRef.current = createOrbitCameraStore({ distance, pitch, target, yaw });
  }

  const cameraStore = store ?? defaultStoreRef.current;
  const cameraRef = useRef<PerspectiveCamera | undefined>(undefined);
  if (cameraRef.current === undefined) {
    cameraRef.current = orbitPerspectiveCamera({
      far,
      fovY,
      near,
      view: cameraStore.getState().view,
    });
  } else {
    syncOrbitPerspectiveCameraDescriptor(cameraRef.current, {
      far,
      fovY,
      near,
      view: cameraStore.getState().view,
    });
  }

  const camera = cameraRef.current;
  const orbitControlsProps = useMemo(() => ({
    camera,
    far,
    fovY,
    near,
    store: cameraStore,
  }), [camera, cameraStore, far, fovY, near]);
  const setView = cameraStore.getState().setView;

  return {
    camera,
    getView: () => cameraStore.getState().view,
    orbitControlsProps,
    setView,
    store: cameraStore,
    get view() {
      return cameraStore.getState().view;
    },
  };
};

const useOrbitCameraSync = (
  syncOptions: OrbitCameraSyncOptions | undefined,
): void => {
  const invalidate = useInvalidate();

  useLayoutEffect(() => {
    if (syncOptions === undefined) return undefined;

    const {
      camera,
      far,
      fovY,
      near,
      store,
    } = syncOptions;
    const scheduleRenderLatest = (): void => {
      invalidate();
    };
    const applyView = (view: OrbitCameraView): void => {
      syncOrbitPerspectiveCameraDescriptor(camera, {
        far,
        fovY,
        near,
        view,
      });
      scheduleRenderLatest();
    };

    applyView(store.getState().view);
    const unsubscribe = store.subscribe((state) => {
      applyView(state.view);
    });

    return () => {
      unsubscribe();
    };
  }, [invalidate, syncOptions]);
};

export const createOrbitControls = (
  canvas: HTMLCanvasElement,
  options: OrbitControlsOptions,
): OrbitControlsHandle => {
  let behaviorOptions = toBehaviorOptions(options);
  const currentPanSpeed = (): number => behaviorOptions.panSpeed ?? defaultPanSpeed;
  const currentRotateSpeed = (): number => behaviorOptions.rotateSpeed ?? defaultRotateSpeed;
  const currentZoomSpeed = (): number => behaviorOptions.zoomSpeed ?? defaultZoomSpeed;
  let view: OrbitCameraView = resolveStartingView(options);
  let interaction: InteractionState | undefined;
  const activePointers = new Map<number, PointerContact>();

  const clampView = (nextView: OrbitCameraView): OrbitCameraView => clampOrbitCameraView(nextView, {
    maxDistance: behaviorOptions.maxDistance,
    maxPitch: behaviorOptions.maxPitch,
    minDistance: behaviorOptions.minDistance,
    minPitch: behaviorOptions.minPitch,
  });

  const applyView = (
    nextView: OrbitCameraViewOptions,
    {
      clamp: shouldClamp = true,
      notify = true,
    }: { readonly clamp?: boolean | undefined; readonly notify?: boolean | undefined } = {},
  ): void => {
    const resolvedView = resolveOrbitCameraView(nextView);
    view = shouldClamp ? clampView(resolvedView) : resolvedView;
    if (notify) {
      behaviorOptions.onChange?.(view);
    }
  };

  const applyZoomDelta = (deltaPixels: number, startView = view): void => {
    applyView(zoomOrbitCameraView(startView, deltaPixels, currentZoomSpeed()));
  };

  const startPinch = (): boolean => {
    if (behaviorOptions.enabled === false || behaviorOptions.enableZoom === false) return false;

    const [first, second] = Array.from(activePointers.values());
    if (first === undefined || second === undefined) return false;

    interaction = {
      kind: "pinch",
      pointerIds: [first.pointerId, second.pointerId],
      startDistance: pointerDistance(first, second),
      startView: view,
    };
    return true;
  };

  const startDrag = (event: PointerEvent): void => {
    if (behaviorOptions.enabled === false) return;
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;

    activePointers.set(event.pointerId, toPointerContact(event));
    if (activePointers.size >= 2 && startPinch()) {
      event.preventDefault();
      captureCanvasPointer(canvas, event.pointerId);
      return;
    }
    if (activePointers.size >= 2) {
      activePointers.delete(event.pointerId);
      return;
    }

    const mode: DragMode =
      event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
        ? "orbit"
        : "pan";
    if (mode === "orbit" && behaviorOptions.enableRotate === false) {
      activePointers.delete(event.pointerId);
      return;
    }
    if (mode === "pan" && behaviorOptions.enablePan === false) {
      activePointers.delete(event.pointerId);
      return;
    }

    event.preventDefault();
    captureCanvasPointer(canvas, event.pointerId);
    interaction = {
      kind: "drag",
      mode,
      pointerId: event.pointerId,
      startView: view,
      startX: event.clientX,
      startY: event.clientY,
    };
  };

  const moveDrag = (event: PointerEvent): void => {
    if (!activePointers.has(event.pointerId)) return;

    event.preventDefault();
    activePointers.set(event.pointerId, toPointerContact(event));
    if (interaction === undefined) return;

    if (interaction.kind === "pinch") {
      const [firstPointerId, secondPointerId] = interaction.pointerIds;
      const first = activePointers.get(firstPointerId);
      const second = activePointers.get(secondPointerId);
      if (first === undefined || second === undefined) return;

      applyZoomDelta(interaction.startDistance - pointerDistance(first, second), interaction.startView);
      return;
    }

    if (interaction.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - interaction.startX;
    const deltaY = event.clientY - interaction.startY;

    if (interaction.mode === "orbit") {
      applyView(rotateOrbitCameraView(
        interaction.startView,
        deltaX,
        deltaY,
        currentRotateSpeed(),
      ));
      return;
    }

    applyView(panOrbitCameraView(
      interaction.startView,
      deltaX,
      deltaY,
      currentPanSpeed(),
    ));
  };

  const endDrag = (event: PointerEvent): void => {
    if (!activePointers.has(event.pointerId)) return;

    releaseCanvasPointer(canvas, event.pointerId);
    activePointers.delete(event.pointerId);

    if (interaction?.kind === "pinch" && interaction.pointerIds.includes(event.pointerId)) {
      interaction = undefined;
      return;
    }

    if (interaction?.kind === "drag" && interaction.pointerId === event.pointerId) {
      interaction = undefined;
    }
  };

  const zoomView = (event: WheelEvent): void => {
    if (behaviorOptions.enabled === false || behaviorOptions.enableZoom === false) return;

    event.preventDefault();
    applyZoomDelta(wheelDeltaPixels(event));
  };

  const blockContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };
  const canvasStyle = canvas.style as CSSStyleDeclaration | undefined;
  const previousTouchAction = canvasStyle?.touchAction;
  if (canvasStyle !== undefined) {
    canvasStyle.touchAction = "none";
  }

  canvas.addEventListener("contextmenu", blockContextMenu);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerdown", startDrag);
  canvas.addEventListener("pointermove", moveDrag);
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("wheel", zoomView, { passive: false });

  return {
    dispose: () => {
      for (const pointerId of activePointers.keys()) releaseCanvasPointer(canvas, pointerId);
      canvas.removeEventListener("contextmenu", blockContextMenu);
      canvas.removeEventListener("pointercancel", endDrag);
      canvas.removeEventListener("pointerdown", startDrag);
      canvas.removeEventListener("pointermove", moveDrag);
      canvas.removeEventListener("pointerup", endDrag);
      canvas.removeEventListener("wheel", zoomView);
      if (canvasStyle !== undefined && previousTouchAction !== undefined) {
        canvasStyle.touchAction = previousTouchAction;
      }
      activePointers.clear();
      interaction = undefined;
    },
    getView: () => view,
    setOptions: (nextOptions) => {
      behaviorOptions = toBehaviorOptions(nextOptions);
    },
    setView: (nextView, setViewOptions) => {
      applyView(nextView, {
        clamp: setViewOptions?.clamp,
        notify: setViewOptions?.notify,
      });
    },
  };
};

export const OrbitControls = ({
  camera,
  defaultView,
  enabled,
  enablePan,
  enableRotate,
  enableZoom,
  far = 100,
  fovY = Math.PI / 4,
  maxDistance,
  maxPitch,
  minDistance,
  minPitch,
  near = 0.1,
  onChange,
  panSpeed,
  store,
  rotateSpeed,
  value,
  zoomSpeed,
}: OrbitControlsProps): null => {
  const canvas = useCanvasElement();
  const internalCameraStoreRef = useRef<OrbitCameraStore | undefined>(undefined);
  if (camera !== undefined && store === undefined && internalCameraStoreRef.current === undefined) {
    internalCameraStoreRef.current = createOrbitCameraStore(resolveStartingView({ defaultView, value }));
  }
  const controlsStore = store ?? (camera === undefined ? undefined : internalCameraStoreRef.current);
  const behaviorOptions = toBehaviorOptions({
    enabled,
    enablePan,
    enableRotate,
    enableZoom,
    maxDistance,
    maxPitch,
    minDistance,
    minPitch,
    onChange: controlsStore === undefined && onChange === undefined
      ? undefined
      : (view) => {
          controlsStore?.getState().setView(view);
          onChange?.(view);
        },
    panSpeed,
    rotateSpeed,
    zoomSpeed,
  });
  const behaviorOptionsRef = useRef<OrbitControlsBehaviorOptions>(behaviorOptions);
  const viewInputsRef = useRef<OrbitControlsViewInputs>({ defaultView, value });
  const controlsRef = useRef<OrbitControlsHandle | undefined>(undefined);
  const startingViewRef = useRef<OrbitCameraView | undefined>(undefined);
  const syncOptions = useMemo(() => camera === undefined || controlsStore === undefined
    ? undefined
    : {
        camera,
        far,
        fovY,
        near,
        store: controlsStore,
      }, [camera, controlsStore, far, fovY, near]);
  behaviorOptionsRef.current = behaviorOptions;
  viewInputsRef.current = { defaultView, value };
  startingViewRef.current ??= controlsStore?.getState().view ?? resolveStartingView(viewInputsRef.current);
  useOrbitCameraSync(syncOptions);

  useEffect(() => {
    if (canvas === null) return undefined;
    const controlsStartingView = controlsStore?.getState().view ?? viewInputsRef.current.value ?? startingViewRef.current;
    if (controlsStartingView === undefined) {
      throw new Error("OrbitControls expects value or defaultView");
    }

    const controls = createOrbitControls(canvas, {
      defaultView: controlsStartingView,
      ...behaviorOptionsRef.current,
    });
    controlsRef.current = controls;

    return () => {
      controls.dispose();
      controlsRef.current = undefined;
    };
  }, [canvas]);

  useEffect(() => {
    controlsRef.current?.setOptions(behaviorOptions);
  }, [
    enabled,
    enablePan,
    enableRotate,
    enableZoom,
    maxDistance,
    maxPitch,
    minDistance,
    minPitch,
    onChange,
    panSpeed,
    controlsStore,
    rotateSpeed,
    zoomSpeed,
  ]);

  useEffect(() => {
    if (controlsStore === undefined) return undefined;

    controlsRef.current?.setView(controlsStore.getState().view, { clamp: false, notify: false });
    return controlsStore.subscribe((state) => {
      controlsRef.current?.setView(state.view, { clamp: false, notify: false });
    });
  }, [controlsStore]);

  useEffect(() => {
    if (value === undefined) return;

    if (controlsStore !== undefined) {
      controlsStore.getState().setView(value);
      return;
    }

    controlsRef.current?.setView(value, { clamp: false, notify: false });
  }, [controlsStore, value]);

  return null;
};
