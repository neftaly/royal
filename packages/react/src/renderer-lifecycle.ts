import { useMemo, useSyncExternalStore } from "react";
import { useCanvasRoot } from "./canvas";
import { createObservedExternalStore } from "./observed-external-store";
import type { RoyalRendererRootLifecycleSnapshot } from "./root";

const UNAVAILABLE: RoyalRendererRootLifecycleSnapshot = Object.freeze({
  generation: 0,
  interruptions: 0,
  recoveries: 0,
  state: "unavailable",
});

const sameLifecycle = (
  left: RoyalRendererRootLifecycleSnapshot,
  right: RoyalRendererRootLifecycleSnapshot,
): boolean => left.state === right.state
  && left.generation === right.generation
  && left.interruptions === right.interruptions
  && left.recoveries === right.recoveries
  && left.error === right.error;

/**
 * Observes the surrounding Canvas renderer lifecycle without polling. Returns
 * `unavailable` during server rendering and before the Canvas root is created.
 */
export const useRendererLifecycle = (): RoyalRendererRootLifecycleSnapshot => {
  const root = useCanvasRoot();
  const store = useMemo(() => {
    if (root === null) {
      return createObservedExternalStore(UNAVAILABLE, () => () => undefined, sameLifecycle);
    }
    return createObservedExternalStore(
      root.snapshot().lifecycle,
      (publish) => root.observeLifecycle(publish),
      sameLifecycle,
    );
  }, [root]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => UNAVAILABLE);
};
