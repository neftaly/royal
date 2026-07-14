import { useMemo, useSyncExternalStore } from "react";
import {
  copyXrViewports,
  createInitialXrSessionStoreData,
  reduceXrSessionStoreData,
  type XrSessionTransition,
} from "./xr-session-transitions";

export type XrSessionMode = "immersive-ar" | "immersive-vr" | "inline";

export type XrSessionStatus =
  | "active"
  | "available"
  | "blocked"
  | "checking"
  | "ending"
  | "error"
  | "starting"
  | "suspended"
  | "unavailable";

/** Why acquisition failed even though immersive XR remains supported. */
export type XrSessionBlockReason =
  | "immersive-session-already-active"
  | "session-request-denied";

/** The browser-owned visibility state of a live XR session. */
export type XrSessionVisibilityState = "hidden" | "visible" | "visible-blurred";

export type XrViewport = {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
};

export type XrSessionState = {
  readonly active: boolean;
  readonly available: boolean;
  readonly blockReason: XrSessionBlockReason | null;
  readonly error: string | null;
  readonly frameIndex: number;
  readonly mode: XrSessionMode | null;
  readonly status: XrSessionStatus;
  readonly visibilityState: XrSessionVisibilityState | null;
  readonly viewCount: number;
  readonly viewports: readonly XrViewport[];
};

export type XrSessionControlSnapshot<Session extends object = object> = {
  readonly session: Session | null;
};

/** Acquisition state accepted before any browser-owned session exists. */
export type XrSessionStoreInitialState = {
  readonly available?: boolean;
  readonly mode?: XrSessionMode | null;
};

export type XrSessionAvailabilityOptions = {
  readonly mode?: XrSessionMode | null;
};

export type XrSessionBeginOptions = {
  readonly mode?: XrSessionMode | null;
};

export type XrSessionActivationOptions = {
  readonly mode: XrSessionMode;
  readonly visibilityState?: XrSessionVisibilityState;
};

export type XrSessionBlockOptions = {
  readonly available?: boolean;
  readonly mode?: XrSessionMode | null;
};

export type XrSessionEndOptions = {
  readonly available?: boolean;
};

export type XrSessionFailureOptions = {
  readonly available?: boolean;
  readonly mode?: XrSessionMode | null;
};

export type XrSessionFrameRecord = {
  readonly frameIndex?: number;
  readonly viewCount?: number;
  readonly viewports?: readonly XrViewport[];
};

export type XrSessionStoreActions<Session extends object = object> = {
  readonly activateSession: (
    session: Session,
    options: XrSessionActivationOptions,
  ) => void;
  readonly beginSession: (
    session?: Session | null,
    options?: XrSessionBeginOptions,
  ) => void;
  readonly beginSessionEnd: () => void;
  readonly blockSession: (
    reason: XrSessionBlockReason,
    error?: unknown,
    options?: XrSessionBlockOptions,
  ) => void;
  readonly endSession: (options?: XrSessionEndOptions) => void;
  readonly failSession: (
    error: unknown,
    options?: XrSessionFailureOptions,
  ) => void;
  /** Restores a still-owned session after `session.end()` rejects. */
  readonly failSessionEnd: (error: unknown) => void;
  readonly recordFrame: (frame?: XrSessionFrameRecord) => void;
  readonly reset: (state?: XrSessionStoreInitialState) => void;
  readonly setAvailability: (
    available: boolean,
    options?: XrSessionAvailabilityOptions,
  ) => void;
  readonly setSessionVisibility: (visibilityState: XrSessionVisibilityState) => void;
};

export type XrSessionStoreState<Session extends object = object> =
  XrSessionState &
  XrSessionControlSnapshot<Session> &
  XrSessionStoreActions<Session>;

export interface XrSessionStore<Session extends object = object> {
  getInitialState(this: void): XrSessionStoreState<Session>;
  getState(this: void): XrSessionStoreState<Session>;
  subscribe(this: void, listener: () => void): () => void;
}

export type XrSessionSelectorEquality<State> = (
  previous: State,
  next: State,
) => boolean;

const MODE_OPTIONS = ["mode"] as const;
const AVAILABLE_OPTIONS = ["available"] as const;
const AVAILABLE_MODE_OPTIONS = ["available", "mode"] as const;
const ACTIVATION_OPTIONS = ["mode", "visibilityState"] as const;
const FRAME_FIELDS = ["frameIndex", "viewCount", "viewports"] as const;
const VIEWPORT_FIELDS = ["height", "width", "x", "y"] as const;
const XR_MODES: readonly XrSessionMode[] = ["immersive-ar", "immersive-vr", "inline"];
const XR_VISIBILITY_STATES: readonly XrSessionVisibilityState[] = [
  "hidden",
  "visible",
  "visible-blurred",
];
const XR_BLOCK_REASONS: readonly XrSessionBlockReason[] = [
  "immersive-session-already-active",
  "session-request-denied",
];

const validateActionObject = (
  value: unknown,
  allowedNames: readonly string[],
  label: string,
): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  for (const name of Object.keys(value)) {
    if (!allowedNames.includes(name)) {
      throw new TypeError(`${label} contains unsupported field ${JSON.stringify(name)}`);
    }
  }
  return value as Record<string, unknown>;
};

const validateOptionalAvailability = (value: unknown, label: string): void => {
  if (value !== undefined && typeof value !== "boolean") {
    throw new TypeError(`${label} available must be a boolean`);
  }
};

const validateMode = (value: unknown, label: string, required: boolean): void => {
  if (value === undefined && !required) return;
  if (value !== null && !XR_MODES.includes(value as XrSessionMode)) {
    throw new TypeError(`${label} mode must be immersive-ar, immersive-vr, inline, or null`);
  }
  if (required && value === null) {
    throw new TypeError(`${label} mode must be immersive-ar, immersive-vr, or inline`);
  }
};

const validateModeOptions = (
  value: unknown,
  allowedNames: readonly string[],
  label: string,
  modeRequired = false,
): void => {
  const options = validateActionObject(value, allowedNames, label);
  validateOptionalAvailability(options.available, label);
  validateMode(options.mode, label, modeRequired);
};

const validateSession = (session: unknown, label: string): void => {
  if ((typeof session !== "object" || session === null) && typeof session !== "function") {
    throw new TypeError(`${label} session must be an object`);
  }
};

const validateNonNegativeInteger = (
  value: unknown,
  label: string,
  required = false,
): void => {
  if ((required && value === undefined) || (value !== undefined && (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
  ))) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
};

const validateFrameRecord = (frame: XrSessionFrameRecord): void => {
  const record = validateActionObject(frame, FRAME_FIELDS, "XR recordFrame frame");
  validateNonNegativeInteger(record.frameIndex, "XR recordFrame frameIndex");
  validateNonNegativeInteger(record.viewCount, "XR recordFrame viewCount");
  if (record.viewports !== undefined && !Array.isArray(record.viewports)) {
    throw new TypeError("XR recordFrame viewports must be an array");
  }
  if (Array.isArray(record.viewports)) {
    for (let index = 0; index < record.viewports.length; index += 1) {
      const viewport = validateActionObject(
        record.viewports[index],
        VIEWPORT_FIELDS,
        `XR recordFrame viewports[${index}]`,
      );
      validateNonNegativeInteger(
        viewport.height,
        `XR recordFrame viewports[${index}].height`,
        true,
      );
      validateNonNegativeInteger(
        viewport.width,
        `XR recordFrame viewports[${index}].width`,
        true,
      );
      validateNonNegativeInteger(viewport.x, `XR recordFrame viewports[${index}].x`, true);
      validateNonNegativeInteger(viewport.y, `XR recordFrame viewports[${index}].y`, true);
    }
  }
};

export const selectXrSessionSnapshot = <Session extends object>(
  state: XrSessionStoreState<Session>,
): XrSessionState => ({
  active: state.active,
  available: state.available,
  blockReason: state.blockReason,
  error: state.error,
  frameIndex: state.frameIndex,
  mode: state.mode,
  status: state.status,
  visibilityState: state.visibilityState,
  viewCount: state.viewCount,
  viewports: copyXrViewports(state.viewports),
});

export const selectXrSessionControlSnapshot = <Session extends object>(
  state: XrSessionStoreState<Session>,
): XrSessionControlSnapshot<Session> => ({
  session: state.session,
});

export const createXrSessionStore = <Session extends object = object>(
  initialState: XrSessionStoreInitialState = {},
): XrSessionStore<Session> => {
  const initialData = createInitialXrSessionStoreData<Session>(initialState);
  const listeners = new Map<object, () => void>();
  let data = initialData;
  let current: XrSessionStoreState<Session>;
  const apply = (transition: XrSessionTransition<Session>): void => {
    const next = reduceXrSessionStoreData(data, transition);
    if (next === data) return;
    data = next;
    current = { ...data, ...actions };
    let firstFailure: unknown;
    let failed = false;
    for (const listener of listeners.values()) {
      try {
        listener();
      } catch (error) {
        if (!failed) firstFailure = error;
        failed = true;
      }
    }
    if (failed) throw firstFailure;
  };
  const actions: XrSessionStoreActions<Session> = {
    activateSession: (session, options) => {
      validateSession(session, "XR activateSession");
      validateModeOptions(options, ACTIVATION_OPTIONS, "XR activateSession options", true);
      const visibilityState = options.visibilityState;
      if (
        visibilityState !== undefined
        && !XR_VISIBILITY_STATES.includes(visibilityState)
      ) {
        throw new TypeError("XR activateSession visibilityState must be hidden, visible, or visible-blurred");
      }
      apply({ options, session, type: "activate" });
    },
    beginSession: (session = null, options = {}) => {
      if (session !== null) validateSession(session, "XR beginSession");
      validateModeOptions(options, MODE_OPTIONS, "XR beginSession options");
      apply({ options, session, type: "begin" });
    },
    beginSessionEnd: () => apply({ type: "begin-end" }),
    blockSession: (reason, error, options = {}) => {
      if (!XR_BLOCK_REASONS.includes(reason)) {
        throw new TypeError("XR blockSession reason must be immersive-session-already-active or session-request-denied");
      }
      validateModeOptions(options, AVAILABLE_MODE_OPTIONS, "XR blockSession options");
      apply({ error, options, reason, type: "block" });
    },
    endSession: (options = {}) => {
      validateModeOptions(options, AVAILABLE_OPTIONS, "XR endSession options");
      apply({ options, type: "end" });
    },
    failSession: (error, options = {}) => {
      validateModeOptions(options, AVAILABLE_MODE_OPTIONS, "XR failSession options");
      apply({ error, options, type: "fail" });
    },
    failSessionEnd: (error) => apply({ error, type: "fail-end" }),
    recordFrame: (frame = {}) => {
      validateFrameRecord(frame);
      apply({ frame, type: "frame" });
    },
    reset: (state) => apply({
      state: state === undefined
        ? initialData
        : createInitialXrSessionStoreData<Session>(state),
      type: "reset",
    }),
    setAvailability: (available, options = {}) => {
      if (typeof available !== "boolean") {
        throw new TypeError("XR setAvailability available must be a boolean");
      }
      validateModeOptions(options, MODE_OPTIONS, "XR setAvailability options");
      apply({ available, options, type: "availability" });
    },
    setSessionVisibility: (visibilityState) => {
      if (!XR_VISIBILITY_STATES.includes(visibilityState)) {
        throw new TypeError("XR setSessionVisibility visibilityState must be hidden, visible, or visible-blurred");
      }
      apply({ type: "visibility", visibilityState });
    },
  };
  current = { ...data, ...actions };
  const initial = current;
  return {
    getInitialState: () => initial,
    getState: () => current,
    subscribe: (listener) => {
      if (typeof listener !== "function") {
        throw new TypeError("XR session store subscribe listener must be a function");
      }
      const token = {};
      listeners.set(token, listener);
      return () => {
        listeners.delete(token);
      };
    },
  };
};

type XrSessionSelectionReaders<State> = {
  readonly getInitialSelection: () => State;
  readonly getSelection: () => State;
};

const createCachedSelectionReader = <StoreState, State>(
  getSnapshot: () => StoreState,
  selector: (state: StoreState) => State,
  isEqual: XrSessionSelectorEquality<State>,
): (() => State) => {
  let cachedSelection: State;
  let cachedSnapshot: StoreState;
  let hasCachedSelection = false;

  return () => {
    const snapshot = getSnapshot();
    if (hasCachedSelection && Object.is(snapshot, cachedSnapshot)) {
      return cachedSelection;
    }

    const selection = selector(snapshot);
    if (hasCachedSelection && isEqual(cachedSelection, selection)) {
      cachedSnapshot = snapshot;
      return cachedSelection;
    }

    cachedSelection = selection;
    cachedSnapshot = snapshot;
    hasCachedSelection = true;
    return selection;
  };
};

/** @internal Builds the selector-aware snapshot boundary used by the React hook. */
export const createXrSessionSelectionReaders = <Session extends object, State>(
  store: XrSessionStore<Session>,
  selector: (state: XrSessionStoreState<Session>) => State,
  isEqual: XrSessionSelectorEquality<State> = Object.is,
): XrSessionSelectionReaders<State> => {
  if (typeof selector !== "function") {
    throw new TypeError("XR session selector must be a function");
  }
  if (typeof isEqual !== "function") {
    throw new TypeError("XR session selector equality must be a function");
  }
  return {
    getInitialSelection: createCachedSelectionReader(store.getInitialState, selector, isEqual),
    getSelection: createCachedSelectionReader(store.getState, selector, isEqual),
  };
};

/**
 * Subscribes to a derived XR value. Store updates whose selected value is equal
 * do not rerender the component; pass an equality function for object selections.
 */
export const useXrSessionSelector = <Session extends object, State>(
  store: XrSessionStore<Session>,
  selector: (state: XrSessionStoreState<Session>) => State,
  isEqual: XrSessionSelectorEquality<State> = Object.is,
): State => {
  const readers = useMemo(
    () => createXrSessionSelectionReaders(store, selector, isEqual),
    [isEqual, selector, store],
  );
  return useSyncExternalStore(
    store.subscribe,
    readers.getSelection,
    readers.getInitialSelection,
  );
};

export const useXrSessionSnapshot = <Session extends object>(
  store: XrSessionStore<Session>,
): XrSessionState =>
  useXrSessionSelector(store, selectXrSessionSnapshot);
