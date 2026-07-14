export type ObservedExternalStore<Snapshot> = Readonly<{
  getSnapshot: () => Snapshot;
  subscribe: (listener: () => void) => () => void;
}>;

/** @internal Adapts an immediate push observer to React's stable snapshot contract. */
export const createObservedExternalStore = <Snapshot>(
  initialSnapshot: Snapshot,
  observe: (publish: (snapshot: Snapshot) => void) => () => void,
  equal: (left: Snapshot, right: Snapshot) => boolean = Object.is,
): ObservedExternalStore<Snapshot> => {
  let current = initialSnapshot;
  let stopObserving: (() => void) | undefined;
  const listeners = new Set<() => void>();

  const publish = (next: Snapshot): void => {
    if (equal(current, next)) return;
    current = next;
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      if (listeners.size === 1) {
        try {
          stopObserving = observe(publish);
        } catch (error) {
          listeners.delete(listener);
          throw error;
        }
      }
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
        if (listeners.size !== 0) return;
        stopObserving?.();
        stopObserving = undefined;
      };
    },
  };
};
