import type { RendererRootSnapshot } from "@royal/renderer-webgl";
import { useCallback, useSyncExternalStore } from "react";
import { useOptionalCanvasRoot } from "../runtime/canvas-context";
import {
  selectObservedRoot,
  type RendererObservationOptions,
} from "./select-root";

const subscribeUnavailable = (): (() => void) => () => undefined;
const getUnavailable = (): undefined => undefined;

/**
 * Observes the broad renderer snapshot for diagnostics and tooling.
 *
 * This subscription updates for submitted frames and resource changes. Product
 * UI should prefer the focused lifecycle, size, and asset-status hooks.
 */
export const useRendererSnapshot = (
  options?: RendererObservationOptions,
): RendererRootSnapshot | undefined => {
  const root = selectObservedRoot(useOptionalCanvasRoot(), options, "useRendererSnapshot");
  const subscribe = useCallback(
    (listener: () => void) => root?.subscribe(listener) ?? subscribeUnavailable(),
    [root],
  );
  const getSnapshot = useCallback(
    () => root?.getSnapshot() ?? getUnavailable(),
    [root],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getUnavailable);
};
