import type {
  WebGlContextLifecycle,
  WebGlContextSnapshot,
} from "./root-types";

export type WebGlContextLifecycleObserver = (snapshot: WebGlContextSnapshot) => void;
export type WebGlContextLifecycleObserverFailureReporter = (failure: unknown) => void;

type ObserverRecord = {
  active: boolean;
  readonly callback: WebGlContextLifecycleObserver;
  lastSequence: number;
};

type BroadcastPublication = {
  cancelled: boolean;
  readonly kind: "broadcast";
  ready: boolean;
  readonly sequence: number;
  readonly snapshot: WebGlContextSnapshot;
};

type Publication = BroadcastPublication | {
  readonly kind: "observer";
  readonly observer: ObserverRecord;
  readonly sequence: number;
  readonly snapshot: WebGlContextSnapshot;
};

type CapturedFailure = {
  readonly value: unknown;
};

const initialSnapshot = (): WebGlContextSnapshot => Object.freeze({
  generation: 1,
  lifecycle: "active",
  losses: 0,
  restores: 0,
});

const nextSnapshot = (
  current: WebGlContextSnapshot,
  lifecycle: WebGlContextLifecycle,
  changes: {
    readonly clearError?: boolean;
    readonly generation?: number;
    readonly lastError?: string;
    readonly losses?: number;
    readonly restores?: number;
  } = {},
): WebGlContextSnapshot => Object.freeze({
  generation: changes.generation ?? current.generation,
  ...(changes.lastError !== undefined
    ? { lastError: changes.lastError }
    : changes.clearError === true || current.lastError === undefined
      ? {}
      : { lastError: current.lastError }),
  lifecycle,
  losses: changes.losses ?? current.losses,
  restores: changes.restores ?? current.restores,
});

const reportObserverFailure = (failure: unknown): void => {
  try {
    console.error("Royal WebGL context lifecycle observer failed", failure);
  } catch {
    // Observer isolation must not depend on the host's diagnostic sink.
  }
};

/** Owns WebGL context state and serializes every observer-visible transition. */
export class WebGlContextLifecycleOwner {
  readonly #observers = new Set<ObserverRecord>();
  readonly #publications: Publication[] = [];
  readonly #reportFailure: WebGlContextLifecycleObserverFailureReporter;
  #current = initialSnapshot();
  #draining = false;
  #publicationHead = 0;
  #sequence = 0;

  constructor(
    reportFailure: WebGlContextLifecycleObserverFailureReporter = reportObserverFailure,
  ) {
    this.#reportFailure = reportFailure;
  }

  get generation(): number {
    return this.#current.generation;
  }

  get lifecycle(): WebGlContextLifecycle {
    return this.#current.lifecycle;
  }

  snapshot(): WebGlContextSnapshot {
    return this.#current;
  }

  /** Active/restoring -> lost. A repeated loss or terminal loss is ignored. */
  lose(beforePublish?: () => void): boolean {
    if (this.lifecycle === "disposed" || this.lifecycle === "lost") return false;
    return this.#transition(nextSnapshot(this.#current, "lost", {
      generation: this.generation + 1,
      losses: this.#current.losses + 1,
    }), beforePublish);
  }

  /** Lost -> restoring. Observers run before the caller starts GPU restoration. */
  beginRestore(): boolean {
    if (this.lifecycle !== "lost") return false;
    return this.#transition(nextSnapshot(this.#current, "restoring"));
  }

  /**
   * Restoring -> active. Callers must finish fallible resource restoration
   * before committing success so observers never see a rolled-back active state.
   */
  finishRestore(): boolean {
    if (this.lifecycle !== "restoring") return false;
    return this.#transition(nextSnapshot(this.#current, "active", {
      clearError: true,
      restores: this.#current.restores + 1,
    }));
  }

  /** Restoring -> lost without changing generation or counters. */
  failRestore(lastError: string): boolean {
    if (this.lifecycle !== "restoring") return false;
    return this.#transition(nextSnapshot(this.#current, "lost", { lastError }));
  }

  /** Any nonterminal state -> disposed, incrementing generation exactly once. */
  dispose(beforePublish?: () => void): boolean {
    if (this.lifecycle === "disposed") return false;
    return this.#transition(nextSnapshot(this.#current, "disposed", {
      generation: this.generation + 1,
    }), beforePublish);
  }

  /**
   * Delivers the current snapshot once, then future snapshots in transition
   * order. Unsubscribing before an observer's turn cancels that delivery.
   */
  observe(callback: WebGlContextLifecycleObserver): () => void {
    const observer: ObserverRecord = { active: true, callback, lastSequence: -1 };
    if (this.lifecycle !== "disposed") this.#observers.add(observer);
    this.#publications.push({
      kind: "observer",
      observer,
      sequence: this.#sequence,
      snapshot: this.#current,
    });
    this.#drain();

    return () => {
      if (!observer.active) return;
      observer.active = false;
      this.#observers.delete(observer);
    };
  }

  #transition(
    next: WebGlContextSnapshot,
    beforePublish?: () => void,
  ): boolean {
    this.#sequence += 1;
    const sequence = this.#sequence;
    this.#current = next;
    const publication: BroadcastPublication = {
      cancelled: false,
      kind: "broadcast",
      ready: false,
      sequence,
      snapshot: next,
    };
    this.#publications.push(publication);

    let failure: CapturedFailure | undefined;
    try {
      beforePublish?.();
    } catch (value) {
      failure = { value };
    }

    if (this.#current !== next) publication.cancelled = true;
    publication.ready = true;
    this.#drain();
    if (failure !== undefined) throw failure.value;
    return true;
  }

  #deliver(observer: ObserverRecord, sequence: number, snapshot: WebGlContextSnapshot): void {
    if (!observer.active || observer.lastSequence >= sequence) return;
    observer.lastSequence = sequence;
    try {
      observer.callback(snapshot);
    } catch (failure) {
      try {
        this.#reportFailure(failure);
      } catch {
        // A failing reporter must not interrupt later lifecycle observers.
      }
    }
  }

  #drain(): void {
    if (this.#draining) return;
    this.#draining = true;
    try {
      while (this.#publicationHead < this.#publications.length) {
        const publication = this.#publications[this.#publicationHead]!;
        if (publication.kind === "broadcast" && !publication.ready) break;
        this.#publicationHead += 1;
        if (publication.kind === "observer") {
          this.#deliver(publication.observer, publication.sequence, publication.snapshot);
          continue;
        }
        if (publication.cancelled) continue;

        const observers = Array.from(this.#observers);
        for (const observer of observers) {
          if (!this.#observers.has(observer)) continue;
          this.#deliver(observer, publication.sequence, publication.snapshot);
        }
        if (publication.snapshot.lifecycle === "disposed") {
          for (const observer of this.#observers) observer.active = false;
          this.#observers.clear();
        }
      }
    } finally {
      if (this.#publicationHead === this.#publications.length) {
        this.#publications.length = 0;
        this.#publicationHead = 0;
      }
      this.#draining = false;
    }
  }
}
