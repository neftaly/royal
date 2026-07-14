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
  const listeners = new Map<object, () => void>();
  const publicationQueue: Snapshot[] = [];
  let drainingPublications = false;
  let publicationHead = 0;

  const publish = (next: Snapshot): void => {
    publicationQueue.push(next);
    if (drainingPublications) return;
    drainingPublications = true;
    let firstFailure: unknown;
    let failed = false;
    try {
      while (publicationHead < publicationQueue.length) {
        const published = publicationQueue[publicationHead++]!;
        if (equal(current, published)) continue;
        current = published;
        for (const listener of listeners.values()) {
          try {
            listener();
          } catch (error) {
            if (!failed) firstFailure = error;
            failed = true;
          }
        }
      }
    } finally {
      publicationQueue.length = 0;
      publicationHead = 0;
      drainingPublications = false;
    }
    if (failed) throw firstFailure;
  };

  return {
    getSnapshot: () => current,
    subscribe: (listener) => {
      if (typeof listener !== "function") {
        throw new TypeError("Observed external store listener must be a function");
      }
      const token = {};
      listeners.set(token, listener);
      if (listeners.size === 1) {
        try {
          stopObserving = observe(publish);
        } catch (error) {
          listeners.delete(token);
          throw error;
        }
      }
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(token);
        if (listeners.size !== 0) return;
        stopObserving?.();
        stopObserving = undefined;
      };
    },
  };
};
