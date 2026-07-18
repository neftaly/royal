export type ContextLifecycleSnapshot =
  | Readonly<{
    failure?: never;
    generation: number;
    interruptions: number;
    phase: "active";
    recoveries: number;
  }>
  | Readonly<{
    failure?: string;
    generation: number;
    interruptions: number;
    phase: "lost" | "restoring";
    recoveries: number;
  }>
  | Readonly<{
    failure?: string;
    generation: number;
    interruptions: number;
    phase: "disposed";
    recoveries: number;
  }>;

export type ContextLifecycleEvent =
  | Readonly<{ kind: "context-lost" }>
  | Readonly<{ kind: "dispose" }>
  | Readonly<{ failure: string; kind: "restoration-failed" }>
  | Readonly<{ kind: "restoration-started" }>
  | Readonly<{ kind: "restored" }>;

export const createActiveContextLifecycle = (): ContextLifecycleSnapshot => Object.freeze({
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
      return Object.freeze({
        generation: current.generation + 1,
        interruptions: current.interruptions + 1,
        phase: "lost",
        recoveries: current.recoveries,
      });
    case "restoration-started":
      if (current.phase !== "lost") return undefined;
      return Object.freeze({ ...current, phase: "restoring" });
    case "restored":
      if (current.phase !== "restoring") return undefined;
      return Object.freeze({
        generation: current.generation,
        interruptions: current.interruptions,
        phase: "active",
        recoveries: current.recoveries + 1,
      });
    case "restoration-failed":
      if (current.phase !== "restoring") return undefined;
      return Object.freeze({ ...current, failure: event.failure, phase: "lost" });
    case "dispose":
      if (current.phase === "disposed") return undefined;
      return Object.freeze({
        ...current,
        generation: current.generation + 1,
        phase: "disposed",
      });
  }
};
