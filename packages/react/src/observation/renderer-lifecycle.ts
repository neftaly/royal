import { useMemo } from "react";
import { useOptionalCanvasRoot } from "../runtime/canvas-context";
import { useLifecycleSnapshot } from "./root-snapshot";
import {
  selectObservedRoot,
  type RendererHookOptions,
} from "./select-root";

/** Focused renderer lifecycle using the same `status` discriminant as asset and XR status. */
export type RendererLifecycleSnapshot =
  | Readonly<{
    error?: never;
    generation: number;
    interruptions: number;
    recoveries: number;
    status: "available" | "disposed" | "unavailable";
  }>
  | Readonly<{
    error: string;
    generation: number;
    interruptions: number;
    recoveries: number;
    status: "failed";
  }>;

const UNAVAILABLE: RendererLifecycleSnapshot = {
  generation: 0,
  interruptions: 0,
  recoveries: 0,
  status: "unavailable",
};

/** Observes renderer availability without polling or subscribing to unrelated state. */
export const useRendererLifecycle = (
  options?: RendererHookOptions,
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
    if (context.phase === "active") return { ...shared, status: "available" };
    if (context.phase === "disposed") return { ...shared, status: "disposed" };
    if (context.failure !== undefined) {
      return { ...shared, error: context.failure, status: "failed" };
    }
    return { ...shared, status: "unavailable" };
  }, [context]);
};
