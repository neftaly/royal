import { useMemo, useSyncExternalStore } from "react";
import type { XrSessionState } from "./session-model";
import {
  createXrSessionSelectionReaders,
  selectXrSessionSnapshot,
  type XrSessionSelectorEquality,
  type XrSessionStore,
  type XrSessionStoreState,
} from "./store";

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
