/** Browser WebXR session mode requested by a Royal session controller. */
export type XrSessionMode = "immersive-ar" | "immersive-vr" | "inline";
/** Browser-reported visibility of a live WebXR session. */
export type XrVisibilityState = "hidden" | "visible" | "visible-blurred";

/**
 * Browser XR lifecycle: capability check, availability, acquisition, live
 * visibility, termination, or terminal controller disposal.
 */
export type XrSessionStatus =
  | "checking"
  | "unavailable"
  | "available"
  | "starting"
  | "blocked"
  | "active"
  | "suspended"
  | "ending"
  | "error"
  | "disposed";

/** Exact observable state of one browser XR session controller. */
export type XrSessionSnapshot =
  | Readonly<{
    error?: never;
    mode: XrSessionMode;
    status: "available" | "checking" | "disposed" | "starting" | "unavailable";
    visibilityState: null;
  }>
  | Readonly<{
    /** Human-readable acquisition or renderer failure. */
    error: string;
    mode: XrSessionMode;
    status: "blocked" | "error";
    visibilityState: null;
  }>
  | Readonly<{
    /** Rejected termination failure retained while the session stays live. */
    error?: string;
    mode: XrSessionMode;
    status: "active";
    visibilityState: "visible" | "visible-blurred";
  }>
  | Readonly<{
    /** Rejected termination failure retained while the session stays live. */
    error?: string;
    mode: XrSessionMode;
    status: "suspended";
    visibilityState: "hidden";
  }>
  | Readonly<{
    /** Earlier rejected termination failure, if a later exit is now pending. */
    error?: string;
    mode: XrSessionMode;
    status: "ending";
    visibilityState: XrVisibilityState;
  }>;

export type XrSessionEvent =
  | Readonly<{ kind: "availability"; supported: boolean }>
  | Readonly<{ kind: "begin" }>
  | Readonly<{ kind: "activate"; visibilityState: XrVisibilityState }>
  | Readonly<{ kind: "visibility"; visibilityState: XrVisibilityState }>
  | Readonly<{ kind: "begin-end" }>
  | Readonly<{ error: string; kind: "end-failed" }>
  | Readonly<{ kind: "ended" }>
  | Readonly<{ blocked: boolean; error: string; kind: "fail" }>
  | Readonly<{ kind: "dispose" }>;

export const initialXrSessionSnapshot = (mode: XrSessionMode): XrSessionSnapshot => ({
  mode,
  status: "checking",
  visibilityState: null,
});

/** Pure authority for capability, acquisition, live-session, and terminal state. */
export const reduceXrSessionSnapshot = (
  current: XrSessionSnapshot,
  event: XrSessionEvent,
): XrSessionSnapshot => {
  if (current.status === "disposed") return current;
  switch (event.kind) {
    case "availability":
      if (current.status === "starting" || current.status === "active"
        || current.status === "suspended" || current.status === "ending") return current;
      return {
        mode: current.mode,
        status: event.supported ? "available" : "unavailable",
        visibilityState: null,
      };
    case "begin":
      if (current.status !== "available" && current.status !== "blocked"
        && current.status !== "error") return current;
      return { mode: current.mode, status: "starting", visibilityState: null };
    case "activate":
      if (current.status !== "starting") return current;
      return event.visibilityState === "hidden"
        ? { mode: current.mode, status: "suspended", visibilityState: "hidden" }
        : {
            mode: current.mode,
            status: "active",
            visibilityState: event.visibilityState,
          };
    case "visibility":
      if (current.status !== "active" && current.status !== "suspended"
        && current.status !== "ending") return current;
      if (current.status === "ending") {
        return { ...current, visibilityState: event.visibilityState };
      }
      return event.visibilityState === "hidden"
        ? { ...current, status: "suspended", visibilityState: "hidden" }
        : { ...current, status: "active", visibilityState: event.visibilityState };
    case "begin-end":
      if (current.status !== "active" && current.status !== "suspended") return current;
      return { ...current, status: "ending" };
    case "end-failed":
      if (current.status !== "ending") return current;
      return current.visibilityState === "hidden"
        ? { ...current, error: event.error, status: "suspended", visibilityState: "hidden" }
        : {
            ...current,
            error: event.error,
            status: "active",
            visibilityState: current.visibilityState === "visible-blurred"
              ? "visible-blurred"
              : "visible",
          };
    case "ended":
      if (current.status !== "starting" && current.status !== "active"
        && current.status !== "suspended" && current.status !== "ending") return current;
      return { mode: current.mode, status: "available", visibilityState: null };
    case "fail":
      return {
        error: event.error,
        mode: current.mode,
        status: event.blocked ? "blocked" : "error",
        visibilityState: null,
      };
    case "dispose":
      return { mode: current.mode, status: "disposed", visibilityState: null };
  }
};
