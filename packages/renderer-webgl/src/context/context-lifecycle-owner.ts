import {
  createActiveContextLifecycle,
  reduceContextLifecycle,
  type ContextLifecycleEvent,
  type ContextLifecycleSnapshot,
} from "./context-lifecycle";

export type ContextLifecycleListener = () => void;

type Publication = Readonly<{
  listeners: readonly ContextLifecycleListener[];
  snapshot: ContextLifecycleSnapshot;
}>;

/** Serializes the cold mutable context lifecycle and its external-store observation. */
export class ContextLifecycleOwner {
  readonly #listeners = new Set<ContextLifecycleListener>();
  readonly #onListenerError: (error: unknown) => void;
  readonly #publications: Publication[] = [];
  #current: ContextLifecycleSnapshot;
  #draining = false;
  #planned: ContextLifecycleSnapshot;
  #publicationIndex = 0;

  constructor(onListenerError: (error: unknown) => void) {
    this.#onListenerError = onListenerError;
    const initial = createActiveContextLifecycle();
    this.#current = initial;
    this.#planned = initial;
  }

  getSnapshot = (): ContextLifecycleSnapshot => this.#current;

  subscribe = (listener: ContextLifecycleListener): (() => void) => {
    if (this.#planned.phase === "disposed") return () => undefined;
    this.#listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.#listeners.delete(listener);
    };
  };

  transition(event: ContextLifecycleEvent): boolean {
    const next = reduceContextLifecycle(this.#planned, event);
    if (next === undefined) return false;
    this.#planned = next;
    this.#publications.push({ listeners: [...this.#listeners], snapshot: next });
    this.#drain();
    return true;
  }

  #drain(): void {
    if (this.#draining) return;
    this.#draining = true;
    try {
      while (this.#publicationIndex < this.#publications.length) {
        const publication = this.#publications[this.#publicationIndex]!;
        this.#publicationIndex += 1;
        this.#current = publication.snapshot;
        for (const listener of publication.listeners) {
          if (!this.#listeners.has(listener)) continue;
          try {
            listener();
          } catch (error) {
            try {
              this.#onListenerError(error);
            } catch {
              // Listener isolation must not depend on a diagnostic sink.
            }
          }
        }
        if (publication.snapshot.phase === "disposed") this.#listeners.clear();
      }
    } finally {
      this.#publications.length = 0;
      this.#publicationIndex = 0;
      this.#draining = false;
    }
  }
}
