import type { WebGlContextSnapshot } from "../root-types";

export type WebGlContextLifecycleEvent =
  | Readonly<{ kind: "begin-restore" }>
  | Readonly<{ kind: "dispose" }>
  | Readonly<{ kind: "fail-restore"; lastError: string }>
  | Readonly<{ kind: "finish-restore" }>
  | Readonly<{ kind: "lose" }>;

export const initialWebGlContextSnapshot = (): WebGlContextSnapshot => Object.freeze({
  generation: 1,
  lifecycle: "active",
  losses: 0,
  restores: 0,
});

/** Pure legal-state transition; rejected events leave ownership and publication to the shell. */
export const reduceWebGlContextLifecycle = (
  current: WebGlContextSnapshot,
  event: WebGlContextLifecycleEvent,
): WebGlContextSnapshot | undefined => {
  switch (event.kind) {
    case "lose":
      if (current.lifecycle === "disposed" || current.lifecycle === "lost") return undefined;
      return Object.freeze({
        generation: current.generation + 1,
        lifecycle: "lost",
        losses: current.losses + 1,
        restores: current.restores,
      });
    case "begin-restore":
      if (current.lifecycle !== "lost") return undefined;
      return Object.freeze({ ...current, lifecycle: "restoring" });
    case "finish-restore": {
      if (current.lifecycle !== "restoring") return undefined;
      const { lastError: _lastError, ...withoutError } = current;
      return Object.freeze({
        ...withoutError,
        lifecycle: "active",
        restores: current.restores + 1,
      });
    }
    case "fail-restore":
      if (current.lifecycle !== "restoring") return undefined;
      return Object.freeze({ ...current, lastError: event.lastError, lifecycle: "lost" });
    case "dispose":
      if (current.lifecycle === "disposed") return undefined;
      return Object.freeze({
        ...current,
        generation: current.generation + 1,
        lifecycle: "disposed",
      });
  }
};
