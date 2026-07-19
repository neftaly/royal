import type { RoyalRendererRoot } from "@royal/renderer-webgl";
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

export type UseXrSessionOptions = XrSessionControllerOptions & Readonly<{
  /** Explicit root for controls outside Canvas; omit inside Canvas. */
  root?: RoyalRendererRoot | null;
}>;

export type UseXrSessionResult = XrSessionSnapshot & Readonly<{
  enter(): Promise<boolean>;
  exit(): Promise<void>;
  refreshAvailability(): Promise<void>;
}>;

const unavailableSubscribe = (): (() => void) => () => undefined;

/** Owns one lazy browser XR lifecycle for the surrounding Royal Canvas. */
export const useXrSession = (options: UseXrSessionOptions = {}): UseXrSessionResult => {
  const contextRoot = useOptionalCanvasRoot();
  const hasExplicitRoot = Object.hasOwn(options, "root");
  if (!hasExplicitRoot && contextRoot === undefined) {
    throw new Error("useXrSession must be used inside <Canvas> or passed an explicit root");
  }
  const root = hasExplicitRoot ? options.root ?? null : contextRoot ?? null;
  const mode = options.mode ?? "immersive-vr";
  const requiredFeatures = options.session?.requiredFeatures?.join("\u0000") ?? "";
  const optionalFeatures = options.session?.optionalFeatures?.join("\u0000") ?? "";
  const referenceSpaces = options.renderer?.referenceSpacePreference?.join("\u0000") ?? "";
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
        : { referenceSpacePreference: options.renderer.referenceSpacePreference }),
      ...(options.renderer.webGlLayer === undefined
        ? {}
        : { webGlLayer: options.renderer.webGlLayer }),
    } }),
    ...(options.session === undefined ? {} : { session: {
      ...(options.session.optionalFeatures === undefined
        ? {}
        : { optionalFeatures: options.session.optionalFeatures }),
      ...(options.session.requiredFeatures === undefined
        ? {}
        : { requiredFeatures: options.session.requiredFeatures }),
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
  const unavailable = useMemo(() => root === null
    ? { ...initialXrSessionSnapshot(mode), status: "unavailable" as const }
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
