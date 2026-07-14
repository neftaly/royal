import { useEffect, useState } from "react";
import { useCanvasRoot } from "./canvas";
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

/** Observes the surrounding Canvas renderer lifecycle without polling. */
export const useRendererLifecycle = (): RoyalRendererRootLifecycleSnapshot => {
  const root = useCanvasRoot();
  const [lifecycle, setLifecycle] = useState<RoyalRendererRootLifecycleSnapshot>(UNAVAILABLE);

  useEffect(() => {
    if (root === null) {
      setLifecycle(UNAVAILABLE);
      return undefined;
    }

    return root.observeLifecycle((next) => {
      setLifecycle((current) => sameLifecycle(current, next) ? current : next);
    });
  }, [root]);

  return lifecycle;
};
