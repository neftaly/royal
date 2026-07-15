export type VirtualTexturePageLifecycle =
  | { readonly attempts: number; readonly kind: "backoff"; readonly retryDelayMs: number }
  | { readonly kind: "capacity-blocked" }
  | { readonly attempts: number; readonly kind: "eligible" }
  | { readonly attempts: number; readonly kind: "loading" }
  | { readonly kind: "queued" }
  | { readonly attempts: number; readonly kind: "terminal" };

export type VirtualTexturePageLifecycleEvent =
  | { readonly kind: "capacity-denied"; readonly permanent: boolean }
  | { readonly kind: "capacity-released" }
  | { readonly kind: "context-lost" }
  | { readonly disposition: "discarded" | "invalid" | "queued"; readonly kind: "decoded" }
  | { readonly kind: "gpu-settled" }
  | { readonly kind: "grant" }
  | { readonly kind: "load-rejected" }
  | { readonly kind: "release" }
  | { readonly kind: "retry-elapsed" }
  | { readonly kind: "unrequestable" };

export interface VirtualTexturePageLifecyclePolicy {
  readonly retryBaseDelayMs: number;
  readonly retryLimit: number;
}

export interface VirtualTexturePageLifecycleTransition {
  readonly retryDelayMs?: number;
  readonly state?: VirtualTexturePageLifecycle;
}

const attemptsOf = (state: VirtualTexturePageLifecycle | undefined): number =>
  state !== undefined && "attempts" in state ? state.attempts : 0;

export const reduceVirtualTexturePageLifecycle = (
  state: VirtualTexturePageLifecycle | undefined,
  event: VirtualTexturePageLifecycleEvent,
  policy: VirtualTexturePageLifecyclePolicy,
): VirtualTexturePageLifecycleTransition => {
  switch (event.kind) {
    case "capacity-denied":
      return event.permanent
        ? { state: { attempts: policy.retryLimit, kind: "terminal" } }
        : { state: { kind: "capacity-blocked" } };
    case "capacity-released":
      return state?.kind === "capacity-blocked"
        ? { state: { attempts: 0, kind: "eligible" } }
        : state === undefined ? {} : { state };
    case "grant": {
      if (state !== undefined && state.kind !== "eligible") return { state };
      return { state: { attempts: attemptsOf(state), kind: "loading" } };
    }
    case "decoded": {
      if (state?.kind !== "loading") return state === undefined ? {} : { state };
      switch (event.disposition) {
        case "queued":
          return { state: { kind: "queued" } };
        case "discarded":
          return {};
        case "invalid":
          return { state: { attempts: Math.max(attemptsOf(state), policy.retryLimit), kind: "terminal" } };
      }
    }
    case "load-rejected": {
      if (state?.kind !== "loading") return state === undefined ? {} : { state };
      const attempts = attemptsOf(state);
      if (attempts >= policy.retryLimit) return { state: { attempts, kind: "terminal" } };
      const retryDelayMs = Math.max(0, policy.retryBaseDelayMs) * (2 ** attempts);
      return {
        retryDelayMs,
        state: { attempts: attempts + 1, kind: "backoff", retryDelayMs },
      };
    }
    case "retry-elapsed":
      return state?.kind === "backoff"
        ? { state: { attempts: state.attempts, kind: "eligible" } }
        : state === undefined ? {} : { state };
    case "gpu-settled":
      return state?.kind === "queued" ? {} : state === undefined ? {} : { state };
    case "context-lost":
      return state?.kind === "backoff" || state?.kind === "loading"
        ? { state: { attempts: state.attempts, kind: "eligible" } }
        : state === undefined ? {} : { state };
    case "release":
      return {};
    case "unrequestable":
      return { state: { attempts: policy.retryLimit, kind: "terminal" } };
  }
};

export const virtualTexturePageLifecycleClaimed = (
  state: VirtualTexturePageLifecycle | undefined,
): boolean => state?.kind === "loading" || state?.kind === "queued";

export const virtualTexturePageLifecycleLoading = (
  state: VirtualTexturePageLifecycle | undefined,
): boolean => state?.kind === "loading";

export const virtualTexturePageLifecycleRetryBlocked = (
  state: VirtualTexturePageLifecycle | undefined,
): boolean => state?.kind === "backoff"
  || state?.kind === "capacity-blocked"
  || state?.kind === "terminal";

export const virtualTexturePageLifecycleCapacityBlocked = (
  state: VirtualTexturePageLifecycle | undefined,
): boolean => state?.kind === "capacity-blocked";

export const virtualTexturePageLifecycleCanBecomeResident = (
  state: VirtualTexturePageLifecycle | undefined,
): boolean => state?.kind !== "terminal";
