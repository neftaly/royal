import type { RendererRoot } from "@royal/renderer-webgl";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useOptionalCanvasRoot } from "../runtime/canvas-context";
import {
  createXrSessionController,
  type XrSessionControllerOptions,
} from "./session-controller";
import {
  initialXrSessionSnapshot,
  type XrSessionSnapshot,
} from "./session-state";

/** Declarative WebXR session policy and optional explicit renderer ownership. */
export type UseXrSessionOptions = XrSessionControllerOptions & Readonly<{
  /** Explicit root for controls outside Canvas; omit inside Canvas, or pass `null` to disable. */
  root?: RendererRoot | null;
}>;

/** Current discriminated WebXR lifecycle plus stable session actions. */
export type UseXrSessionResult = XrSessionSnapshot & Readonly<{
  /** Requests a browser session from user activation; true means rendering became active. */
  enter(): Promise<boolean>;
  /** Requests termination of the current browser session. */
  exit(): Promise<void>;
  /** Rechecks support while no browser session is owned. */
  refreshAvailability(): Promise<void>;
}>;

const unavailableSubscribe = (): (() => void) => () => undefined;

const emptyXrStringList: readonly never[] = [];

const useStableXrStringList = <Value extends string>(
  values: readonly Value[] | undefined,
): readonly Value[] => {
  const retained = useRef<readonly Value[]>(emptyXrStringList);
  const next = values ?? emptyXrStringList;
  let changed = retained.current.length !== next.length;
  for (let index = 0; !changed && index < next.length; index += 1) {
    changed = retained.current[index] !== next[index];
  }
  if (changed) retained.current = [...next];
  return retained.current;
};

/** Owns one lazy browser XR lifecycle for the surrounding Royal Canvas. */
export const useXrSession = (options: UseXrSessionOptions = {}): UseXrSessionResult => {
  const contextRoot = useOptionalCanvasRoot();
  const hasExplicitRoot = Object.hasOwn(options, "root");
  if (!hasExplicitRoot && contextRoot === undefined) {
    throw new Error("useXrSession must be used inside <Canvas> or passed an explicit root");
  }
  const root = hasExplicitRoot ? options.root ?? null : contextRoot ?? null;
  const mode = options.mode ?? "immersive-vr";
  const requiredFeatures = useStableXrStringList(options.session?.requiredFeatures);
  const optionalFeatures = useStableXrStringList(options.session?.optionalFeatures);
  const referenceSpaces = useStableXrStringList(options.renderer?.referenceSpacePreference);
  const antialias = options.renderer?.webGlLayer?.antialias;
  const framebufferScaleFactor = options.renderer?.webGlLayer?.framebufferScaleFactor;
  const onFrameSnapshot = options.renderer?.onFrameSnapshot;
  const frameSnapshotRef = useRef(onFrameSnapshot);
  frameSnapshotRef.current = onFrameSnapshot;
  const stableFrameSnapshot = useCallback<NonNullable<typeof onFrameSnapshot>>(
    (snapshot) => frameSnapshotRef.current?.(snapshot),
    [],
  );
  const telemetry = onFrameSnapshot !== undefined;
  const controller = useMemo(() => root === null ? null : createXrSessionController(root, {
    mode,
    ...(options.renderer === undefined ? {} : { renderer: {
      ...(telemetry ? { onFrameSnapshot: stableFrameSnapshot } : {}),
      ...(options.renderer.referenceSpacePreference === undefined
        ? {}
        : { referenceSpacePreference: referenceSpaces }),
      ...(options.renderer.webGlLayer === undefined
        ? {}
        : { webGlLayer: options.renderer.webGlLayer }),
    } }),
    ...(options.session === undefined ? {} : { session: {
      ...(options.session.optionalFeatures === undefined
        ? {}
        : { optionalFeatures }),
      ...(options.session.requiredFeatures === undefined
        ? {}
        : { requiredFeatures }),
    } }),
  }), [
    antialias,
    framebufferScaleFactor,
    mode,
    optionalFeatures,
    referenceSpaces,
    requiredFeatures,
    root,
    stableFrameSnapshot,
    telemetry,
  ]);
  const activeControllerRef = useRef<typeof controller>(null);
  useEffect(() => {
    if (controller === null) return undefined;
    activeControllerRef.current = controller;
    void controller.refreshAvailability();
    return () => {
      if (activeControllerRef.current === controller) activeControllerRef.current = null;
      queueMicrotask(() => {
        // React Strict Mode replays effects with the same memoized controller.
        // A same-turn reattachment retains it; replacement or unmount releases it.
        if (activeControllerRef.current !== controller) controller.dispose();
      });
    };
  }, [controller, activeControllerRef]);
  const unavailable = useMemo<XrSessionSnapshot>(() => root === null
    ? { mode, status: "unavailable", visibilityState: null }
    : initialXrSessionSnapshot(mode), [mode, root]);
  const getUnavailable = useCallback(() => unavailable, [unavailable]);
  const snapshot = useSyncExternalStore(
    controller?.subscribe ?? unavailableSubscribe,
    controller?.getSnapshot ?? getUnavailable,
    getUnavailable,
  );
  const enter = useCallback(() => controller?.enter() ?? Promise.resolve(false), [controller]);
  const exit = useCallback(() => controller?.exit() ?? Promise.resolve(), [controller]);
  const refreshAvailability = useCallback(
    () => controller?.refreshAvailability() ?? Promise.resolve(),
    [controller],
  );
  return useMemo(() => ({ ...snapshot, enter, exit, refreshAvailability }), [
    enter,
    exit,
    refreshAvailability,
    snapshot,
  ]);
};
