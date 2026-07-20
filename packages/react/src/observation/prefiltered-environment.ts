import {
  prefilteredEnvironment,
  type PrefilteredEnvironmentLight,
} from "@royal/renderer-core";
import type { PrefilteredEnvironmentAssetSnapshot } from "@royal/renderer-webgl";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useOptionalCanvasRoot } from "../runtime/canvas-context";
import {
  selectObservedRoot,
  type RendererObservationOptions,
} from "./select-root";

/** Focused transport/preparation lifecycle for one offline environment artifact. */
export type PrefilteredEnvironmentStatus = PrefilteredEnvironmentAssetSnapshot;
/** Source string or exact environment descriptor observed by `usePrefilteredEnvironmentStatus`. */
export type PrefilteredEnvironmentStatusInput = string | PrefilteredEnvironmentLight;

const IDLE: PrefilteredEnvironmentAssetSnapshot = { state: "idle" };
const subscribeIdle = (): (() => void) => () => undefined;
const getIdle = (): PrefilteredEnvironmentAssetSnapshot => IDLE;

/** Observes one offline environment source/version without frame-wide subscriptions. */
export const usePrefilteredEnvironmentStatus = (
  input: PrefilteredEnvironmentStatusInput,
  options?: RendererObservationOptions,
): PrefilteredEnvironmentStatus => {
  const root = selectObservedRoot(
    useOptionalCanvasRoot(),
    options,
    "usePrefilteredEnvironmentStatus",
  );
  const src = typeof input === "string" ? input : input.src;
  const version = typeof input === "string" ? undefined : input.version;
  const environment = useMemo(() => prefilteredEnvironment({
    src,
    ...(version === undefined ? {} : { version }),
  }), [src, version]);
  const subscribe = useCallback(
    (listener: () => void) => root?.subscribePrefilteredEnvironment(
      environment,
      listener,
    ) ?? subscribeIdle(),
    [environment, root],
  );
  const getSnapshot = useCallback(
    () => root?.getPrefilteredEnvironmentSnapshot(environment) ?? getIdle(),
    [environment, root],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getIdle);
};
