import type {
  XrSessionActivationOptions,
  XrSessionAvailabilityOptions,
  XrSessionBeginOptions,
  XrSessionBlockOptions,
  XrSessionBlockReason,
  XrSessionControlSnapshot,
  XrSessionEndOptions,
  XrSessionFailureOptions,
  XrSessionFrameRecord,
  XrSessionState,
  XrSessionStoreInitialState,
  XrSessionStatus,
  XrSessionVisibilityState,
  XrViewport,
} from "./xr-session-model";
import { isXrSessionMode } from "./xr-session-model";
import { recordWithAllowedFields } from "./validation";

const XR_INITIAL_STATE_FIELDS = ["available", "mode"] as const;

export type XrSessionStoreData<Session extends object> =
  XrSessionState & XrSessionControlSnapshot<Session>;

export type XrSessionTransition<Session extends object> =
  | Readonly<{ options: XrSessionActivationOptions; session: Session; type: "activate" }>
  | Readonly<{ options: XrSessionBeginOptions; session: Session | null; type: "begin" }>
  | Readonly<{ type: "begin-end" }>
  | Readonly<{
    error: unknown;
    options: XrSessionBlockOptions;
    reason: XrSessionBlockReason;
    type: "block";
  }>
  | Readonly<{ options: XrSessionEndOptions; type: "end" }>
  | Readonly<{ error: unknown; options: XrSessionFailureOptions; type: "fail" }>
  | Readonly<{ error: unknown; type: "fail-end" }>
  | Readonly<{ frame: XrSessionFrameRecord; type: "frame" }>
  | Readonly<{ state: XrSessionStoreData<Session>; type: "reset" }>
  | Readonly<{
    available: boolean;
    options: XrSessionAvailabilityOptions;
    type: "availability";
  }>
  | Readonly<{ type: "visibility"; visibilityState: XrSessionVisibilityState }>;

const errorMessageFromUnknown = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const copyXrViewports = (
  viewports: readonly XrViewport[] | undefined,
): readonly XrViewport[] =>
  viewports?.map(({ height, width, x, y }) => ({ height, width, x, y })) ?? [];

const availabilityStatus = (available: boolean): XrSessionStatus =>
  available ? "available" : "unavailable";

const validateInitialState = (initialState: XrSessionStoreInitialState): void => {
  recordWithAllowedFields(
    initialState,
    XR_INITIAL_STATE_FIELDS,
    "XR session store initialState",
    "option",
  );
  if (initialState.available !== undefined && typeof initialState.available !== "boolean") {
    throw new TypeError("XR session store initialState available must be a boolean");
  }
  if (
    initialState.mode !== undefined
    && initialState.mode !== null
    && !isXrSessionMode(initialState.mode)
  ) {
    throw new TypeError("XR session store initialState mode must be immersive-ar, immersive-vr, inline, or null");
  }
};

export const createInitialXrSessionStoreData = <Session extends object>(
  initialState: XrSessionStoreInitialState = {},
): XrSessionStoreData<Session> => {
  validateInitialState(initialState);
  const available = initialState.available ?? false;
  return {
    available,
    blockReason: null,
    error: null,
    frameIndex: 0,
    mode: initialState.mode ?? null,
    session: null,
    status: initialState.available === undefined
      ? "checking"
      : availabilityStatus(available),
    visibilityState: null,
    viewCount: 0,
    viewports: [],
  };
};

const patchState = <Session extends object>(
  state: XrSessionStoreData<Session>,
  patch: Partial<XrSessionStoreData<Session>>,
): XrSessionStoreData<Session> => ({ ...state, ...patch });

/** Pure XR lifecycle and frame-state transition core. */
export const reduceXrSessionStoreData = <Session extends object>(
  state: XrSessionStoreData<Session>,
  transition: XrSessionTransition<Session>,
): XrSessionStoreData<Session> => {
  switch (transition.type) {
    case "activate": {
      if (state.session !== null && state.session !== transition.session) {
        throw new Error("Cannot activate a different XR session while a live session is owned");
      }
      const visibilityState = transition.options.visibilityState ?? "visible";
      const suspended = visibilityState === "hidden";
      return patchState(state, {
        available: true,
        blockReason: null,
        error: null,
        frameIndex: 0,
        mode: transition.options.mode,
        session: transition.session,
        status: suspended ? "suspended" : "active",
        visibilityState,
        viewCount: 0,
        viewports: [],
      });
    }
    case "begin":
      if (state.session !== null && state.session !== transition.session) {
        throw new Error("Cannot begin a different XR session while a live session is owned");
      }
      return patchState(state, {
        blockReason: null,
        error: null,
        frameIndex: 0,
        ...(transition.options.mode === undefined ? {} : { mode: transition.options.mode }),
        session: transition.session,
        status: "starting",
        visibilityState: null,
        viewCount: 0,
        viewports: [],
      });
    case "begin-end":
      return state.session === null
        ? state
        : patchState(state, { error: null, status: "ending" });
    case "block":
      if (state.session !== null) {
        throw new Error("Cannot block XR acquisition while a live session is owned");
      }
      return patchState(state, {
        ...(transition.options.available === undefined
          ? {}
          : { available: transition.options.available }),
        blockReason: transition.reason,
        error: transition.error === undefined ? null : errorMessageFromUnknown(transition.error),
        frameIndex: 0,
        ...(transition.options.mode === undefined ? {} : { mode: transition.options.mode }),
        session: null,
        status: "blocked",
        viewCount: 0,
        viewports: [],
        visibilityState: null,
      });
    case "end": {
      const available = transition.options.available ?? state.available;
      return patchState(state, {
        available,
        blockReason: null,
        error: null,
        mode: null,
        session: null,
        status: availabilityStatus(available),
        visibilityState: null,
        viewCount: 0,
        viewports: [],
      });
    }
    case "fail":
      return patchState(state, {
        ...(transition.options.available === undefined
          ? {}
          : { available: transition.options.available }),
        blockReason: null,
        error: errorMessageFromUnknown(transition.error),
        frameIndex: 0,
        ...(transition.options.mode === undefined ? {} : { mode: transition.options.mode }),
        session: null,
        status: "error",
        visibilityState: null,
        viewCount: 0,
        viewports: [],
      });
    case "fail-end": {
      if (state.session === null || state.status !== "ending") return state;
      const suspended = state.visibilityState === "hidden";
      return patchState(state, {
        blockReason: null,
        error: errorMessageFromUnknown(transition.error),
        status: suspended ? "suspended" : "active",
      });
    }
    case "frame": {
      if (state.session === null) return state;
      const viewports = transition.frame.viewports === undefined
        ? state.viewports
        : copyXrViewports(transition.frame.viewports);
      return patchState(state, {
        frameIndex: transition.frame.frameIndex ?? state.frameIndex + 1,
        viewCount: transition.frame.viewCount ?? viewports.length,
        viewports,
      });
    }
    case "reset":
      return { ...transition.state };
    case "availability": {
      if (state.session !== null) {
        return patchState(state, {
          available: transition.available,
        });
      }
      return patchState(state, {
        available: transition.available,
        blockReason: null,
        error: null,
        status: availabilityStatus(transition.available),
        ...(transition.options.mode === undefined ? {} : { mode: transition.options.mode }),
        ...(transition.available ? {} : {
          mode: transition.options.mode ?? null,
          session: null,
          visibilityState: null,
          viewCount: 0,
          viewports: [],
        }),
      });
    }
    case "visibility":
      if (state.session === null) return state;
      if (transition.visibilityState === "hidden" && state.status === "active") {
        return patchState(state, {
          status: "suspended",
          visibilityState: transition.visibilityState,
        });
      }
      if (transition.visibilityState !== "hidden" && state.status === "suspended") {
        return patchState(state, {
          status: "active",
          visibilityState: transition.visibilityState,
        });
      }
      return patchState(state, { visibilityState: transition.visibilityState });
  }
};
