export type XrSessionMode = "immersive-ar" | "immersive-vr" | "inline";
export type XrVisibilityState = "hidden" | "visible" | "visible-blurred";

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

export type XrSessionSnapshot = Readonly<{
  /** Human-readable failure retained until the next successful transition. */
  error?: string;
  mode: XrSessionMode;
  status: XrSessionStatus;
  visibilityState: XrVisibilityState | null;
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
      return {
        mode: current.mode,
        status: event.visibilityState === "hidden" ? "suspended" : "active",
        visibilityState: event.visibilityState,
      };
    case "visibility":
      if (current.status !== "active" && current.status !== "suspended"
        && current.status !== "ending") return current;
      return {
        ...current,
        status: current.status === "ending"
          ? "ending"
          : event.visibilityState === "hidden" ? "suspended" : "active",
        visibilityState: event.visibilityState,
      };
    case "begin-end":
      if (current.status !== "active" && current.status !== "suspended") return current;
      return { ...current, status: "ending" };
    case "end-failed":
      if (current.status !== "ending" || current.visibilityState === null) return current;
      return {
        ...current,
        error: event.error,
        status: current.visibilityState === "hidden" ? "suspended" : "active",
      };
    case "ended":
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
