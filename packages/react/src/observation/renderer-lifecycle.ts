import { useMemo } from "react";
import { useOptionalCanvasRoot } from "../runtime/canvas";
import { useLifecycleSnapshot } from "./root-snapshot";
import {
  selectObservedRoot,
  type RendererObservationOptions,
} from "./select-root";

export type RendererLifecycleSnapshot =
  | Readonly<{
    error?: never;
    generation: number;
    interruptions: number;
    recoveries: number;
    state: "available" | "disposed" | "unavailable";
  }>
  | Readonly<{
    error: string;
    generation: number;
    interruptions: number;
    recoveries: number;
    state: "failed";
  }>;

const UNAVAILABLE: RendererLifecycleSnapshot = {
  generation: 0,
  interruptions: 0,
  recoveries: 0,
  state: "unavailable",
};

/** Observes renderer availability without polling or subscribing to unrelated state. */
export const useRendererLifecycle = (
  options?: RendererObservationOptions,
): RendererLifecycleSnapshot => {
  const root = selectObservedRoot(useOptionalCanvasRoot(), options, "useRendererLifecycle");
  const context = useLifecycleSnapshot(root);
  return useMemo(() => {
    if (context === undefined) return UNAVAILABLE;
    const shared = {
      generation: context.generation,
      interruptions: context.interruptions,
      recoveries: context.recoveries,
    };
    if (context.phase === "active") return { ...shared, state: "available" };
    if (context.phase === "disposed") return { ...shared, state: "disposed" };
    if (context.failure !== undefined) {
      return { ...shared, error: context.failure, state: "failed" };
    }
    return { ...shared, state: "unavailable" };
  }, [context]);
};
