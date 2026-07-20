export type RetainedListener = () => void;

type ListenerEntry = {
  active: boolean;
  readonly listener: RetainedListener;
};

const removeEntry = (entry: ListenerEntry): void => {
  entry.active = false;
};

/**
 * Mutation-safe listener storage whose publish path reuses retained entries.
 * Additions wait for the next publication and removals take effect immediately.
 */
export class RetainedListeners {
  #activeCount = 0;
  readonly #entries: ListenerEntry[] = [];
  #publicationDepth = 0;

  get size(): number {
    return this.#activeCount;
  }

  clear(): void {
    for (const entry of this.#entries) removeEntry(entry);
    this.#activeCount = 0;
    if (this.#publicationDepth === 0) this.#entries.length = 0;
  }

  publish(onError: (error: unknown) => void): void {
    const length = this.#entries.length;
    this.#publicationDepth += 1;
    try {
      for (let index = 0; index < length; index += 1) {
        const entry = this.#entries[index]!;
        if (!entry.active) continue;
        try {
          entry.listener();
        } catch (error) {
          try {
            onError(error);
          } catch {
            // Diagnostic sinks cannot interrupt later observers.
          }
        }
      }
    } finally {
      this.#publicationDepth -= 1;
      if (this.#publicationDepth === 0 && this.#activeCount !== this.#entries.length) {
        this.#compact();
      }
    }
  }

  subscribe(listener: RetainedListener): () => void {
    let entry = this.#entries.find(
      (candidate) => candidate.active && candidate.listener === listener,
    );
    if (entry === undefined) {
      entry = { active: true, listener };
      this.#entries.push(entry);
      this.#activeCount += 1;
    }
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      if (!entry.active) return;
      removeEntry(entry);
      this.#activeCount -= 1;
      if (this.#publicationDepth === 0) this.#compact();
    };
  }

  #compact(): void {
    let retained = 0;
    for (let index = 0; index < this.#entries.length; index += 1) {
      const entry = this.#entries[index]!;
      if (!entry.active) continue;
      this.#entries[retained] = entry;
      retained += 1;
    }
    this.#entries.length = retained;
  }
}

/** Keyed facade used by focused asset/status observation. */
export class KeyedRetainedListeners<Key> {
  readonly #groups = new Map<Key, RetainedListeners>();

  clear(): void {
    for (const group of this.#groups.values()) group.clear();
    this.#groups.clear();
  }

  publish(key: Key, onError: (error: unknown) => void): void {
    this.#groups.get(key)?.publish(onError);
  }

  subscribe(key: Key, listener: RetainedListener): () => void {
    let group = this.#groups.get(key);
    if (group === undefined) {
      group = new RetainedListeners();
      this.#groups.set(key, group);
    }
    const unsubscribe = group.subscribe(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      unsubscribe();
      if (group.size === 0 && this.#groups.get(key) === group) this.#groups.delete(key);
    };
  }
}
