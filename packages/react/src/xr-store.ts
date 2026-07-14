import { useMemo, useSyncExternalStore } from "react";

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

type XrSessionStoreData<Session extends object> =
  XrSessionState & XrSessionControlSnapshot<Session>;

type XrSessionStorePatch<Session extends object> = {
  active?: boolean;
  available?: boolean;
  blockReason?: XrSessionBlockReason | null;
  error?: string | null;
  frameIndex?: number;
  mode?: XrSessionMode | null;
  session?: Session | null;
  status?: XrSessionStatus;
  visibilityState?: XrSessionVisibilityState | null;
  viewCount?: number;
  viewports?: readonly XrViewport[];
};

const errorMessageFromUnknown = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const copyXrViewports = (
  viewports: readonly XrViewport[] | undefined,
): readonly XrViewport[] =>
  viewports?.map(({ height, width, x, y }) => ({ height, width, x, y })) ?? [];

const availabilityStatus = (available: boolean): XrSessionStatus =>
  available ? "available" : "unavailable";

const createXrSessionState = (
  state: XrSessionStoreInitialState = {},
): XrSessionState => ({
  active: false,
  available: state.available ?? false,
  blockReason: null,
  error: null,
  frameIndex: 0,
  mode: state.mode ?? null,
  status: state.available === undefined
    ? "checking"
    : availabilityStatus(state.available),
  visibilityState: null,
  viewCount: 0,
  viewports: [],
});

const createXrSessionStoreData = <Session extends object>(
  state: XrSessionState,
): XrSessionStoreData<Session> => ({
  ...state,
  session: null,
});

const createAvailabilityPatch = <Session extends object>(
  available: boolean,
  options: XrSessionAvailabilityOptions = {},
): XrSessionStorePatch<Session> => {
  const patch: XrSessionStorePatch<Session> = {
    available,
    blockReason: null,
    error: null,
    status: availabilityStatus(available),
  };

  if (options.mode !== undefined) patch.mode = options.mode;
  if (!available) {
    patch.active = false;
    patch.mode = options.mode ?? null;
    patch.session = null;
    patch.visibilityState = null;
    patch.viewCount = 0;
    patch.viewports = [];
  }

  return patch;
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
  const initialSnapshot = createXrSessionState(initialState);
  const initialData = createXrSessionStoreData<Session>(initialSnapshot);

  const listeners = new Set<() => void>();
  let current: XrSessionStoreState<Session>;
  const set = (
    patch: XrSessionStorePatch<Session>
      | XrSessionStoreData<Session>
      | ((state: XrSessionStoreState<Session>) => XrSessionStorePatch<Session>),
  ): void => {
    const resolved = typeof patch === "function" ? patch(current) : patch;
    current = { ...current, ...resolved };
    for (const listener of listeners) listener();
  };
  const actions: XrSessionStoreActions<Session> = {
    activateSession: (session, options) => {
      const visibilityState = options.visibilityState ?? "visible";
      const suspended = visibilityState === "hidden";
      set({
        active: !suspended,
        available: true,
        blockReason: null,
        error: null,
        frameIndex: 0,
        mode: options.mode,
        session,
        status: suspended ? "suspended" : "active",
        visibilityState,
        viewCount: 0,
        viewports: [],
      });
    },
    beginSession: (session = null, options = {}) => {
      const patch: XrSessionStorePatch<Session> = {
        active: false,
        blockReason: null,
        error: null,
        frameIndex: 0,
        session,
        status: "starting",
        visibilityState: null,
        viewCount: 0,
        viewports: [],
      };
      if (options.mode !== undefined) patch.mode = options.mode;
      set(patch);
    },
    beginSessionEnd: () => {
      if (current.session === null) return;
      set({
        active: false,
        error: null,
        status: "ending",
      });
    },
    blockSession: (reason, error, options = {}) => {
      if (current.session !== null) {
        throw new Error("Cannot block XR acquisition while a live session is owned");
      }
      const patch: XrSessionStorePatch<Session> = {
        active: false,
        blockReason: reason,
        error: error === undefined ? null : errorMessageFromUnknown(error),
        frameIndex: 0,
        session: null,
        status: "blocked",
        viewCount: 0,
        viewports: [],
        visibilityState: null,
      };
      if (options.available !== undefined) patch.available = options.available;
      if (options.mode !== undefined) patch.mode = options.mode;
      set(patch);
    },
    endSession: (options = {}) => {
      set((state) => {
        const available = options.available ?? state.available;
        return {
          active: false,
          available,
          blockReason: null,
          error: null,
          mode: null,
          session: null,
          status: availabilityStatus(available),
          visibilityState: null,
          viewCount: 0,
          viewports: [],
        };
      });
    },
    failSession: (error, options = {}) => {
      const patch: XrSessionStorePatch<Session> = {
        active: false,
        blockReason: null,
        error: errorMessageFromUnknown(error),
        frameIndex: 0,
        session: null,
        status: "error",
        visibilityState: null,
        viewCount: 0,
        viewports: [],
      };
      if (options.available !== undefined) patch.available = options.available;
      if (options.mode !== undefined) patch.mode = options.mode;
      set(patch);
    },
    recordFrame: (frame = {}) => {
      if (current.session === null) return;
      set((state) => {
        const viewports = frame.viewports === undefined
          ? state.viewports
          : copyXrViewports(frame.viewports);

        return {
          frameIndex: frame.frameIndex ?? state.frameIndex + 1,
          viewCount: frame.viewCount ?? viewports.length,
          viewports,
        };
      });
    },
    reset: (state) => {
      const snapshot = state === undefined
        ? initialSnapshot
        : createXrSessionState(state);
      set(createXrSessionStoreData<Session>(snapshot));
    },
    setAvailability: (available, options) => {
      if (current.session === null) {
        set(createAvailabilityPatch(available, options));
        return;
      }

      const patch: XrSessionStorePatch<Session> = { available };
      if (options?.mode !== undefined) patch.mode = options.mode;
      set(patch);
    },
    setSessionVisibility: (visibilityState) => {
      if (current.session === null) return;
      set((state) => {
        if (visibilityState === "hidden" && state.status === "active") {
          return { active: false, status: "suspended", visibilityState };
        }
        if (visibilityState !== "hidden" && state.status === "suspended") {
          return { active: true, status: "active", visibilityState };
        }
        return { visibilityState };
      });
    },
  };
  current = { ...initialData, ...actions };
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
