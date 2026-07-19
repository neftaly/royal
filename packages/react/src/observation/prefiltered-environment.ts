import {
  prefilteredEnvironment,
  type PrefilteredEnvironmentLight,
} from "@royal/renderer-core";
import type { PrefilteredEnvironmentAssetSnapshot } from "@royal/renderer-webgl";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useOptionalCanvasRoot } from "../runtime/canvas";
import {
  selectObservedRoot,
  type RendererObservationOptions,
} from "./select-root";

export type PrefilteredEnvironmentStatus = PrefilteredEnvironmentAssetSnapshot;

const IDLE: PrefilteredEnvironmentAssetSnapshot = { state: "idle" };
const subscribeIdle = (): (() => void) => () => undefined;
const getIdle = (): PrefilteredEnvironmentAssetSnapshot => IDLE;

/** Observes one offline environment source/version without frame-wide subscriptions. */
export const usePrefilteredEnvironmentStatus = (
  input: PrefilteredEnvironmentLight,
  options?: RendererObservationOptions,
): PrefilteredEnvironmentStatus => {
  const root = selectObservedRoot(
    useOptionalCanvasRoot(),
    options,
    "usePrefilteredEnvironmentStatus",
  );
  const src = input.src;
  const version = input.version;
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
