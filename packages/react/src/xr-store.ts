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
  const listeners = new Set<() => void>();
  let data = initialData;
  let current: XrSessionStoreState<Session>;
  const apply = (transition: XrSessionTransition<Session>): void => {
    const next = reduceXrSessionStoreData(data, transition);
    if (next === data) return;
    data = next;
    current = { ...data, ...actions };
    for (const listener of listeners) listener();
  };
  const actions: XrSessionStoreActions<Session> = {
    activateSession: (session, options) => apply({ options, session, type: "activate" }),
    beginSession: (session = null, options = {}) => apply({ options, session, type: "begin" }),
    beginSessionEnd: () => apply({ type: "begin-end" }),
    blockSession: (reason, error, options = {}) =>
      apply({ error, options, reason, type: "block" }),
    endSession: (options = {}) => apply({ options, type: "end" }),
    failSession: (error, options = {}) => apply({ error, options, type: "fail" }),
    failSessionEnd: (error) => apply({ error, type: "fail-end" }),
    recordFrame: (frame = {}) => apply({ frame, type: "frame" }),
    reset: (state) => apply({
      state: state === undefined
        ? initialData
        : createInitialXrSessionStoreData<Session>(state),
      type: "reset",
    }),
    setAvailability: (available, options = {}) =>
      apply({ available, options, type: "availability" }),
    setSessionVisibility: (visibilityState) =>
      apply({ type: "visibility", visibilityState }),
  };
  current = { ...data, ...actions };
  const initial = current;
  return {
    getInitialState: () => initial,
    getState: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
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
): XrSessionSelectionReaders<State> => ({
  getInitialSelection: createCachedSelectionReader(store.getInitialState, selector, isEqual),
  getSelection: createCachedSelectionReader(store.getState, selector, isEqual),
});

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
