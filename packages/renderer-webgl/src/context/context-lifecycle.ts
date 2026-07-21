export type ContextLifecycleSnapshot =
  | Readonly<{
    failure?: never;
    /** Current WebGL resource generation; changes when handles become invalid. */
    generation: number;
    /** Context-loss transitions observed since root creation. */
    interruptions: number;
    phase: "active";
    /** Successful context restorations since root creation. */
    recoveries: number;
  }>
  | Readonly<{
    /** Bounded restoration failure, retained while the context remains unavailable. */
    failure?: string;
    /** Current WebGL resource generation; changes when handles become invalid. */
    generation: number;
    /** Context-loss transitions observed since root creation. */
    interruptions: number;
    phase: "lost" | "restoring";
    /** Successful context restorations since root creation. */
    recoveries: number;
  }>
  | Readonly<{
    /** Last bounded context/restoration failure, when one preceded disposal. */
    failure?: string;
    /** Terminal generation after disposal invalidated every retained handle. */
    generation: number;
    /** Context-loss transitions observed before disposal. */
    interruptions: number;
    phase: "disposed";
    /** Successful context restorations observed before disposal. */
    recoveries: number;
  }>;

export type ContextLifecycleEvent =
  | Readonly<{ kind: "context-lost" }>
  | Readonly<{ kind: "dispose" }>
  | Readonly<{ failure: string; kind: "restoration-failed" }>
  | Readonly<{ kind: "restoration-started" }>
  | Readonly<{ kind: "restored" }>;

export const createActiveContextLifecycle = (): ContextLifecycleSnapshot => ({
  generation: 1,
  interruptions: 0,
  phase: "active",
  recoveries: 0,
});

/** Returns undefined for an illegal or already-applied lifecycle event. */
export const reduceContextLifecycle = (
  current: ContextLifecycleSnapshot,
  event: ContextLifecycleEvent,
): ContextLifecycleSnapshot | undefined => {
  switch (event.kind) {
    case "context-lost":
      if (current.phase === "disposed" || current.phase === "lost") return undefined;
      return {
        generation: current.generation + 1,
        interruptions: current.interruptions + 1,
        phase: "lost",
        recoveries: current.recoveries,
      };
    case "restoration-started":
      if (current.phase !== "lost") return undefined;
      return { ...current, phase: "restoring" };
    case "restored":
      if (current.phase !== "restoring") return undefined;
      return {
        generation: current.generation,
        interruptions: current.interruptions,
        phase: "active",
        recoveries: current.recoveries + 1,
      };
    case "restoration-failed":
      if (current.phase !== "restoring") return undefined;
      return { ...current, failure: event.failure, phase: "lost" };
    case "dispose":
      if (current.phase === "disposed") return undefined;
      return {
        ...current,
        generation: current.generation + 1,
        phase: "disposed",
      };
  }
};
