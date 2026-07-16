import { useMemo, useSyncExternalStore } from "react";
import { useCanvasRoot } from "./canvas";
import {
  createObservedExternalStore,
  type ObservedExternalStore,
} from "./observed-external-store";
import type { RoyalRendererDiagnosticsSnapshot, RoyalRendererRoot } from "./root";

/** @internal Adapts frame publication to retained diagnostic snapshots. */
export const createRendererDiagnosticsStore = (
  root: RoyalRendererRoot | null,
): ObservedExternalStore<RoyalRendererDiagnosticsSnapshot | undefined> => {
  if (root === null) {
    return createObservedExternalStore<RoyalRendererDiagnosticsSnapshot | undefined>(
      undefined,
      () => () => undefined,
    );
  }
  const initialFrame = root.frame;
  return createObservedExternalStore<RoyalRendererDiagnosticsSnapshot | undefined>(
    root.diagnostics(),
    (publish) => root.observeFrame((frame) => {
      if (frame !== initialFrame) publish(root.diagnostics());
    }),
  );
};

/**
 * Observes root-wide renderer diagnostics after completed frames. Returns
 * `undefined` during server rendering and before the Canvas root is available.
 */
export const useRendererDiagnostics = (): RoyalRendererDiagnosticsSnapshot | undefined => {
  const root = useCanvasRoot();
  const store = useMemo(() => createRendererDiagnosticsStore(root), [root]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => undefined);
};
