import {
  perspectiveCamera,
  type PerspectiveCamera,
  type PerspectiveCameraOptions,
} from "@royal/renderer-core";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useStore } from "zustand/react";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useCanvasElement, useCanvasRoot } from "./canvas";
import { captureCanvasPointer, releaseCanvasPointer } from "./canvas-pointer";

export type OrbitVector3 = readonly [x: number, y: number, z: number];

export type OrbitCameraView = {
  readonly distance: number;
  readonly pitch: number;
  readonly target: OrbitVector3;
  readonly yaw: number;
};

export type OrbitCameraViewOptions = {
  readonly distance: number;
  readonly pitch: number;
  readonly target?: OrbitVector3 | undefined;
  readonly yaw?: number | undefined;
};

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

export type OrbitCameraTransform = {
  readonly position: OrbitVector3;
  readonly rotation: OrbitVector3;
};

export type OrbitPerspectiveCameraOptions =
  Omit<PerspectiveCameraOptions, "position" | "rotation"> & {
    readonly view: OrbitCameraViewOptions;
  };

export type OrbitControlsOptions = {
  readonly defaultView?: OrbitCameraViewOptions;
  readonly value?: OrbitCameraViewOptions;
} & OrbitControlsBehaviorOptions;

export type OrbitControlsProps = OrbitControlsOptions & {
  readonly store?: OrbitCameraStore | undefined;
};

export type OrbitCameraSyncProps =
  Partial<Omit<OrbitPerspectiveCameraOptions, "view">> & {
    readonly camera: PerspectiveCamera;
    readonly store: OrbitCameraStore;
  };

type OrbitControlsViewInputs = {
  readonly defaultView?: OrbitCameraViewOptions | undefined;
  readonly value?: OrbitCameraViewOptions | undefined;
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
const defaultTarget = [0, 0, 0] as const satisfies OrbitVector3;

const clamp = (
  value: number,
  minimum: number | undefined,
  maximum: number | undefined,
): number => Math.min(maximum ?? Infinity, Math.max(minimum ?? -Infinity, value));

export const resolveOrbitCameraView = (view: OrbitCameraViewOptions): OrbitCameraView => ({
  distance: view.distance,
  pitch: view.pitch,
  target: view.target ?? defaultTarget,
  yaw: view.yaw ?? 0,
});

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

const cameraBasis = (
  { pitch, yaw }: OrbitCameraView,
): { readonly right: OrbitVector3; readonly up: OrbitVector3 } => {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cx = Math.cos(pitch);
  const sx = Math.sin(pitch);

  return {
    right: [cy, 0, sy],
    up: [sx * sy, cx, -sx * cy],
  };
};

export const orbitCameraTransform = (
  view: OrbitCameraViewOptions,
): OrbitCameraTransform => {
  const { distance, pitch, target, yaw } = resolveOrbitCameraView(view);
  const cosPitch = Math.cos(pitch);

  return {
    position: [
      target[0] - Math.sin(yaw) * cosPitch * distance,
      target[1] + Math.sin(pitch) * distance,
      target[2] + Math.cos(yaw) * cosPitch * distance,
    ],
    rotation: [-pitch, -yaw, 0],
  };
};

export const orbitPerspectiveCamera = ({
  view,
  ...options
}: OrbitPerspectiveCameraOptions): PerspectiveCamera => perspectiveCamera({
  ...options,
  ...orbitCameraTransform(view),
});

export const updateOrbitPerspectiveCamera = (
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
  readonly controls: Pick<OrbitControlsProps, "store">;
  readonly setView: OrbitCameraState["setView"];
  readonly store: OrbitCameraStore;
  readonly view: OrbitCameraView;
};

export type ImperativeOrbitCameraHookResult = {
  readonly camera: PerspectiveCamera;
  readonly controls: Pick<OrbitControlsProps, "store">;
  readonly getView: () => OrbitCameraView;
  readonly setView: OrbitCameraState["setView"];
  readonly store: OrbitCameraStore;
  readonly sync: OrbitCameraSyncProps;
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
  const view = useOrbitCameraView(cameraStore);
  const controls = useMemo(() => ({ store: cameraStore }), [cameraStore]);
  const setView = cameraStore.getState().setView;

  return {
    camera: orbitPerspectiveCamera({
      far,
      fovY,
      near,
      view,
    }),
    controls,
    setView,
    store: cameraStore,
    view,
  };
};

const renderLatestScene = (root: ReturnType<typeof useCanvasRoot>): void => {
  if (root === null || root.disposed || root.latestScene === undefined) return;

  root.render(root.latestScene);
};

export const OrbitCameraSync = ({
  camera,
  far = 100,
  fovY = Math.PI / 4,
  near = 0.1,
  store,
}: OrbitCameraSyncProps): null => {
  const root = useCanvasRoot();
  const animationFrameRef = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const scheduleRenderLatest = (): void => {
      if (root === null) return;
      if (typeof requestAnimationFrame !== "function") {
        renderLatestScene(root);
        return;
      }
      if (animationFrameRef.current !== undefined) return;

      animationFrameRef.current = requestAnimationFrame(() => {
        animationFrameRef.current = undefined;
        renderLatestScene(root);
      });
    };
    const applyView = (view: OrbitCameraView): void => {
      updateOrbitPerspectiveCamera(camera, {
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
      if (animationFrameRef.current !== undefined && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
    };
  }, [camera, far, fovY, near, root, store]);

  return null;
};

export const useImperativeOrbitCamera = ({
  distance,
  far = 100,
  fovY = Math.PI / 4,
  near = 0.1,
  pitch,
  store,
  target,
  yaw,
}: UseOrbitCameraOptions): ImperativeOrbitCameraHookResult => {
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
    updateOrbitPerspectiveCamera(cameraRef.current, {
      far,
      fovY,
      near,
      view: cameraStore.getState().view,
    });
  }

  const camera = cameraRef.current;
  const controls = useMemo(() => ({ store: cameraStore }), [cameraStore]);
  const setView = cameraStore.getState().setView;
  const sync = useMemo(() => ({
    camera,
    far,
    fovY,
    near,
    store: cameraStore,
  }), [camera, cameraStore, far, fovY, near]);

  return {
    camera,
    controls,
    getView: () => cameraStore.getState().view,
    setView,
    store: cameraStore,
    sync,
  };
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

  const clampView = (nextView: OrbitCameraView): OrbitCameraView => ({
    ...nextView,
    distance: clamp(nextView.distance, behaviorOptions.minDistance, behaviorOptions.maxDistance),
    pitch: clamp(nextView.pitch, behaviorOptions.minPitch, behaviorOptions.maxPitch),
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
    applyView({
      ...startView,
      distance: startView.distance * Math.exp(deltaPixels * currentZoomSpeed()),
    });
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
      applyView({
        ...interaction.startView,
        pitch: interaction.startView.pitch + deltaY * currentRotateSpeed(),
        yaw: interaction.startView.yaw + deltaX * currentRotateSpeed(),
      });
      return;
    }

    const { right, up } = cameraBasis(interaction.startView);
    const scale = interaction.startView.distance * currentPanSpeed();
    applyView({
      ...interaction.startView,
      target: [
        interaction.startView.target[0] - right[0] * deltaX * scale + up[0] * deltaY * scale,
        interaction.startView.target[1] - right[1] * deltaX * scale + up[1] * deltaY * scale,
        interaction.startView.target[2] - right[2] * deltaX * scale + up[2] * deltaY * scale,
      ],
    });
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
  defaultView,
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
  store,
  rotateSpeed,
  value,
  zoomSpeed,
}: OrbitControlsProps): null => {
  const canvas = useCanvasElement();
  const behaviorOptions = toBehaviorOptions({
    enabled,
    enablePan,
    enableRotate,
    enableZoom,
    maxDistance,
    maxPitch,
    minDistance,
    minPitch,
    onChange: store === undefined && onChange === undefined
      ? undefined
      : (view) => {
          store?.getState().setView(view);
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
  behaviorOptionsRef.current = behaviorOptions;
  viewInputsRef.current = { defaultView, value };
  startingViewRef.current ??= store?.getState().view ?? resolveStartingView(viewInputsRef.current);

  useEffect(() => {
    if (canvas === null) return undefined;
    const controlsStartingView = store?.getState().view ?? viewInputsRef.current.value ?? startingViewRef.current;
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
    store,
    rotateSpeed,
    zoomSpeed,
  ]);

  useEffect(() => {
    if (store === undefined) return undefined;

    controlsRef.current?.setView(store.getState().view, { clamp: false, notify: false });
    return store.subscribe((state) => {
      controlsRef.current?.setView(state.view, { clamp: false, notify: false });
    });
  }, [store]);

  useEffect(() => {
    if (value === undefined) return;

    controlsRef.current?.setView(value, { clamp: false, notify: false });
  }, [value]);

  return null;
};
