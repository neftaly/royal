import { useMemo, useSyncExternalStore } from "react";

export type XrSessionMode = "immersive-ar" | "immersive-vr" | "inline";

export type XrSessionStatus =
  | "active"
  | "available"
  | "checking"
  | "ended"
  | "ending"
  | "error"
  | "starting"
  | "unavailable";

export type XrSessionOfferStatus =
  | "accepted"
  | "error"
  | "idle"
  | "offered"
  | "pending"
  | "unsupported";

export type XrViewport = {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
};

export type XrSessionState = {
  readonly active: boolean;
  readonly available: boolean;
  readonly error: string | null;
  readonly frameIndex: number;
  readonly mode: XrSessionMode | null;
  readonly offerError: string | null;
  readonly offerStatus: XrSessionOfferStatus;
  readonly status: XrSessionStatus;
  readonly viewCount: number;
  readonly viewports: readonly XrViewport[];
};

export type XrSessionSnapshot = XrSessionState;

export type XrSessionSerializableState = XrSessionState;

export type XrSessionSerializableSnapshot = XrSessionState;

export type XrSessionControlSnapshot<Session extends object = object> = {
  readonly session: Session | null;
};

export type XrSessionStoreInitialState = Partial<XrSessionState>;

export type XrSessionAvailabilityOptions = {
  readonly mode?: XrSessionMode | null;
  readonly status?: XrSessionStatus;
};

export type XrSessionBeginOptions = {
  readonly mode?: XrSessionMode | null;
  readonly status?: XrSessionStatus;
};

export type XrSessionActivationOptions = {
  readonly mode: XrSessionMode;
  readonly status?: XrSessionStatus;
};

export type XrSessionEndOptions = {
  readonly available?: boolean;
  readonly status?: XrSessionStatus;
};

export type XrSessionFailureOptions = {
  readonly available?: boolean;
  readonly mode?: XrSessionMode | null;
  readonly status?: XrSessionStatus;
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
  readonly endSession: (options?: XrSessionEndOptions | XrSessionStatus) => void;
  readonly failSession: (
    error: unknown,
    options?: XrSessionFailureOptions,
  ) => void;
  readonly recordFrame: (frame?: XrSessionFrameRecord) => void;
  readonly reset: (state?: XrSessionStoreInitialState) => void;
  readonly setOfferStatus: (
    offerStatus: XrSessionOfferStatus,
    offerError?: string | null,
  ) => void;
  readonly setAvailability: (
    available: boolean,
    options?: XrSessionAvailabilityOptions,
  ) => void;
  readonly setSnapshot: (state: XrSessionStoreInitialState) => void;
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
  error?: string | null;
  frameIndex?: number;
  mode?: XrSessionMode | null;
  offerError?: string | null;
  offerStatus?: XrSessionOfferStatus;
  session?: Session | null;
  status?: XrSessionStatus;
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

const normalizeXrSessionStatus = (
  status: XrSessionStatus | undefined,
  fallback: XrSessionStatus,
): XrSessionStatus => status ?? fallback;

const createXrSessionSnapshot = (
  state: XrSessionStoreInitialState = {},
): XrSessionSnapshot => {
  const viewports = copyXrViewports(state.viewports);

  return {
    active: state.active ?? false,
    available: state.available ?? false,
    error: state.error ?? null,
    frameIndex: state.frameIndex ?? 0,
    mode: state.mode ?? null,
    offerError: state.offerError ?? null,
    offerStatus: state.offerStatus ?? "idle",
    status: state.status ?? "checking",
    viewCount: state.viewCount ?? viewports.length,
    viewports,
  };
};

const createXrSessionStoreData = <Session extends object>(
  state: XrSessionStoreInitialState = {},
): XrSessionStoreData<Session> => ({
  ...createXrSessionSnapshot(state),
  session: null,
});

const createXrSessionStorePatch = <Session extends object>(
  state: XrSessionStoreInitialState,
): XrSessionStorePatch<Session> => {
  const patch: XrSessionStorePatch<Session> = {};

  if (state.active !== undefined) patch.active = state.active;
  if (state.available !== undefined) patch.available = state.available;
  if (state.error !== undefined) patch.error = state.error;
  if (state.frameIndex !== undefined) patch.frameIndex = state.frameIndex;
  if (state.mode !== undefined) patch.mode = state.mode;
  if (state.offerError !== undefined) patch.offerError = state.offerError;
  if (state.offerStatus !== undefined) patch.offerStatus = state.offerStatus;
  if (state.status !== undefined) patch.status = state.status;

  if (state.viewports !== undefined) {
    const viewports = copyXrViewports(state.viewports);
    patch.viewports = viewports;
    patch.viewCount = state.viewCount ?? viewports.length;
  } else if (state.viewCount !== undefined) {
    patch.viewCount = state.viewCount;
  }

  return patch;
};

const createAvailabilityPatch = <Session extends object>(
  available: boolean,
  options: XrSessionAvailabilityOptions = {},
): XrSessionStorePatch<Session> => {
  const status = normalizeXrSessionStatus(options.status, availabilityStatus(available));
  const patch: XrSessionStorePatch<Session> = {
    available,
    error: null,
    status,
  };

  if (options.mode !== undefined) patch.mode = options.mode;
  if (!available) {
    patch.active = false;
    patch.mode = options.mode ?? null;
    patch.session = null;
    patch.viewCount = 0;
    patch.viewports = [];
  }

  return patch;
};

export const selectXrSessionSnapshot = <Session extends object>(
  state: XrSessionStoreState<Session>,
): XrSessionSnapshot => ({
  active: state.active,
  available: state.available,
  error: state.error,
  frameIndex: state.frameIndex,
  mode: state.mode,
  offerError: state.offerError,
  offerStatus: state.offerStatus,
  status: state.status,
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
  const initialSnapshot = createXrSessionSnapshot(initialState);
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
      set({
        active: true,
        available: true,
        error: null,
        frameIndex: 0,
        mode: options.mode,
        session,
        status: normalizeXrSessionStatus(options.status, "active"),
        viewCount: 0,
        viewports: [],
      });
    },
    beginSession: (session = null, options = {}) => {
      const patch: XrSessionStorePatch<Session> = {
        active: false,
        error: null,
        frameIndex: 0,
        session,
        status: normalizeXrSessionStatus(options.status, "starting"),
        viewCount: 0,
        viewports: [],
      };
      if (options.mode !== undefined) patch.mode = options.mode;
      set(patch);
    },
    endSession: (options = {}) => {
      const normalizedOptions = typeof options === "string" ? { status: options } : options;
      set((state) => {
        const available = normalizedOptions.available ?? state.available;
        return {
          active: false,
          available,
          error: null,
          mode: null,
          session: null,
          status: normalizeXrSessionStatus(normalizedOptions.status, availabilityStatus(available)),
          viewCount: 0,
          viewports: [],
        };
      });
    },
    failSession: (error, options = {}) => {
      const patch: XrSessionStorePatch<Session> = {
        active: false,
        error: errorMessageFromUnknown(error),
        frameIndex: 0,
        session: null,
        status: normalizeXrSessionStatus(options.status, "error"),
        viewCount: 0,
        viewports: [],
      };
      if (options.available !== undefined) patch.available = options.available;
      if (options.mode !== undefined) patch.mode = options.mode;
      set(patch);
    },
    recordFrame: (frame = {}) => {
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
      set(createXrSessionStoreData<Session>(state ?? initialSnapshot));
    },
    setAvailability: (available, options) => {
      set(createAvailabilityPatch(available, options));
    },
    setOfferStatus: (offerStatus, offerError = null) => {
      set({ offerError, offerStatus });
    },
    setSnapshot: (state) => {
      set(createXrSessionStorePatch<Session>(state));
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
): XrSessionSnapshot =>
  useXrSessionSelector(store, selectXrSessionSnapshot);
