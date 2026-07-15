import type { TextureContentKey, TextureVersion } from "@royal/renderer-core";
import type { ResourceArenaSourceLease } from "./resource-arena";
import type { LoadedTextureSource } from "./texture-sources";
import { ResourceGovernorCpuCapacityError } from "./resource-governor";

export interface OrdinaryTextureSourceRequest {
  readonly contentKey?: TextureContentKey;
  readonly uri: string;
  readonly version?: TextureVersion;
}

export type OrdinaryTextureSourceResult =
  | {
    readonly kind: "ready";
    /** Borrowed until this subscriber releases; ownership and closing remain with the store. */
    readonly source: LoadedTextureSource;
  }
  | { readonly error: unknown; readonly kind: "error" };

export interface OrdinaryTextureSourceSubscription {
  release(): void;
}

export interface OrdinaryTextureSourceJobAdmission {
  release(): void;
}

export interface OrdinaryTextureSourceStoreSnapshot {
  readonly aborts: number;
  readonly deliveryFailures: number;
  /** Shared source identities retained by at least one subscriber. */
  readonly entries: number;
  readonly failures: number;
  readonly starts: number;
  readonly subscribers: number;
  readonly successes: number;
}

/**
 * A subscriber callback failed while observing a borrowed settled result.
 * The store still owns ready sources; `terminate` releases only this subscriber.
 */
export interface OrdinaryTextureSourceDeliveryFailure {
  /** One-based count of consecutive failures delivering this settled result. */
  readonly attempt: number;
  readonly error: unknown;
  readonly request: OrdinaryTextureSourceRequest;
  readonly result: OrdinaryTextureSourceResult;
  /** Re-delivers this result if the subscriber is still active and failed. */
  retry(): boolean;
  /** Releases this subscriber, including its share of any settled source ownership. */
  terminate(): void;
}

export interface OrdinaryTextureSourceAcquireOptions {
  readonly onDeliveryFailure?: (failure: OrdinaryTextureSourceDeliveryFailure) => void;
}

type SourceSubscriber = {
  readonly listener: (result: OrdinaryTextureSourceResult) => void;
  readonly onDeliveryFailure: ((failure: OrdinaryTextureSourceDeliveryFailure) => void) | undefined;
  readonly request: OrdinaryTextureSourceRequest;
  consecutiveFailures: number;
  deliveryFailed: boolean;
  notifying: boolean;
  released: boolean;
};

type SourceJob = {
  admission?: OrdinaryTextureSourceJobAdmission;
  admitting: boolean;
  controller: AbortController;
  cpuCapacityBlocked: boolean;
  readonly key: string;
  lease?: ResourceArenaSourceLease;
  readonly listeners: Map<number, SourceSubscriber>;
  readonly request: OrdinaryTextureSourceRequest;
  result?: OrdinaryTextureSourceResult;
  settled: boolean;
  source?: LoadedTextureSource;
  started: boolean;
};

type CapturedError = {
  error: unknown;
  present: boolean;
};

const identityPart = (value: TextureContentKey | TextureVersion): readonly [string, string] =>
  [typeof value, String(value)];

/** Decoded-content identity; upload-only sampler/color-space state is deliberately absent. */
export const ordinaryTextureSourceKey = (request: OrdinaryTextureSourceRequest): string =>
  request.contentKey === undefined
    ? JSON.stringify(["uri", request.uri, request.version === undefined ? null : identityPart(request.version)])
    : JSON.stringify(["content", identityPart(request.contentKey)]);

/**
 * Root-local decoded image work. Jobs are shared by content identity, while
 * WebGL texture creation and upload stay independently keyed by upload state.
 */
export class OrdinaryTextureSourceStore {
  readonly #admit: (() => OrdinaryTextureSourceJobAdmission | undefined) | undefined;
  readonly #close: (source: LoadedTextureSource) => void;
  readonly #jobs = new Map<string, SourceJob>();
  readonly #load: (request: OrdinaryTextureSourceRequest, signal: AbortSignal) => Promise<LoadedTextureSource>;
  readonly #retain: (source: LoadedTextureSource) => ResourceArenaSourceLease;
  #aborts = 0;
  #disposed = false;
  #deliveryFailures = 0;
  #failures = 0;
  #nextListener = 1;
  #starts = 0;
  #successes = 0;

  constructor(options: {
    readonly admit?: () => OrdinaryTextureSourceJobAdmission | undefined;
    readonly close: (source: LoadedTextureSource) => void;
    readonly load: (request: OrdinaryTextureSourceRequest, signal: AbortSignal) => Promise<LoadedTextureSource>;
    readonly retain: (source: LoadedTextureSource) => ResourceArenaSourceLease;
  }) {
    this.#admit = options.admit;
    this.#close = options.close;
    this.#load = options.load;
    this.#retain = options.retain;
  }

  acquire(
    request: OrdinaryTextureSourceRequest,
    listener: (result: OrdinaryTextureSourceResult) => void,
    options?: OrdinaryTextureSourceAcquireOptions,
  ): OrdinaryTextureSourceSubscription {
    if (this.#disposed) throw new Error("OrdinaryTextureSourceStore is disposed");
    const key = ordinaryTextureSourceKey(request);
    let job = this.#jobs.get(key);
    let start = false;
    if (job === undefined) {
      job = {
        admitting: false,
        controller: new AbortController(),
        cpuCapacityBlocked: false,
        key,
        listeners: new Map(),
        request,
        settled: false,
        started: false,
      };
      this.#jobs.set(key, job);
      this.#starts += 1;
      start = true;
    }

    const listenerKey = this.#nextListener;
    this.#nextListener += 1;
    const subscriber: SourceSubscriber = {
      consecutiveFailures: 0,
      deliveryFailed: false,
      listener,
      notifying: false,
      onDeliveryFailure: options?.onDeliveryFailure,
      request,
      released: false,
    };
    job.listeners.set(listenerKey, subscriber);
    if (start) this.#tryStart(job);
    if (!start && job.result !== undefined) this.#notifyListener(job, listenerKey, subscriber, job.result);

    return {
      release: () => {
        this.#releaseSubscriber(job, listenerKey, subscriber);
      },
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const jobs = [...this.#jobs.values()];
    this.#jobs.clear();
    const firstError: CapturedError = { error: undefined, present: false };
    for (const job of jobs) {
      job.listeners.clear();
      if (!job.settled) {
        try {
          job.controller.abort();
        } catch (error) {
          this.#captureFirstError(firstError, error);
        }
        this.#aborts += 1;
      } else {
        try {
          this.#releaseSource(job);
        } catch (error) {
          this.#captureFirstError(firstError, error);
        }
      }
    }
    if (firstError.present) throw firstError.error;
  }

  snapshot(): OrdinaryTextureSourceStoreSnapshot {
    let subscribers = 0;
    for (const job of this.#jobs.values()) subscribers += job.listeners.size;
    return {
      aborts: this.#aborts,
      deliveryFailures: this.#deliveryFailures,
      entries: this.#jobs.size,
      failures: this.#failures,
      starts: this.#starts,
      subscribers,
      successes: this.#successes,
    };
  }

  /** Retries content jobs denied by a shared root-level decode budget. */
  wake(): void {
    if (this.#disposed) return;
    for (const job of this.#jobs.values()) {
      if (job.started || job.settled || job.cpuCapacityBlocked || job.listeners.size === 0) continue;
      if (!this.#tryStart(job)) return;
    }
  }

  wakeCpuCapacity(): boolean {
    if (this.#disposed) return false;
    let woke = false;
    // Give every row blocked at the start of this wake one chance. Admission
    // still bounds concurrent work, while a large row that re-denies cannot
    // strand a later smaller row that fits the released capacity.
    for (const [key, job] of Array.from(this.#jobs)) {
      if (!job.cpuCapacityBlocked || job.listeners.size === 0) continue;
      job.cpuCapacityBlocked = false;
      job.controller = new AbortController();
      this.#jobs.delete(key);
      this.#jobs.set(key, job);
      this.#tryStart(job);
      woke = true;
    }
    return woke;
  }

  #tryStart(job: SourceJob): boolean {
    if (this.#disposed || this.#jobs.get(job.key) !== job || job.listeners.size === 0) return true;
    if (job.admitting) return false;
    let admission: OrdinaryTextureSourceJobAdmission | undefined;
    job.admitting = true;
    try {
      admission = this.#admit?.();
    } catch (error) {
      this.#settleError(job, error);
      return true;
    } finally {
      job.admitting = false;
    }
    if (this.#admit !== undefined && admission === undefined) return false;
    if (this.#disposed || this.#jobs.get(job.key) !== job || job.listeners.size === 0) {
      admission?.release();
      return true;
    }
    if (admission !== undefined) job.admission = admission;
    job.started = true;
    this.#start(job, job.request);
    return true;
  }

  #start(job: SourceJob, request: OrdinaryTextureSourceRequest): void {
    let pending: Promise<LoadedTextureSource>;
    try {
      pending = Promise.resolve(this.#load(request, job.controller.signal));
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then((source) => {
      if (this.#jobs.get(job.key) !== job || job.listeners.size === 0) {
        try {
          this.#close(source);
        } catch {
          // A stale completion has no remaining observer to receive cleanup failures.
        }
        return;
      }
      let lease: ResourceArenaSourceLease;
      try {
        lease = this.#retain(source);
      } catch (error) {
        try {
          this.#close(source);
        } catch {
          // The retain failure remains the settlement cause; close was still attempted.
        }
        if (this.#jobs.get(job.key) !== job || job.listeners.size === 0) return;
        if (error instanceof ResourceGovernorCpuCapacityError && !error.permanent) {
          // The decoded size is unknowable before loading, and retaining this
          // source would violate the hard CPU cap. A later capacity wake may
          // therefore repeat the encoded load/decode instead of keeping
          // unaccounted decoded memory alive.
          job.started = false;
          job.cpuCapacityBlocked = true;
          return;
        }
        this.#settleError(job, error);
        return;
      }
      if (this.#jobs.get(job.key) !== job || job.listeners.size === 0) {
        try {
          if (lease.release()) this.#close(source);
        } catch {
          // Re-entrant teardown detached the job; ownership unwind was still attempted.
        }
        return;
      }
      job.lease = lease;
      job.source = source;
      job.settled = true;
      this.#successes += 1;
      const result: OrdinaryTextureSourceResult = { kind: "ready", source };
      job.result = result;
      this.#notify(job, result);
    }, (error: unknown) => {
      if (this.#jobs.get(job.key) !== job || job.listeners.size === 0) return;
      this.#settleError(job, error);
    }).finally(() => {
      const admission = job.admission;
      delete job.admission;
      try {
        admission?.release();
      } catch {
        // Settlement and source ownership are already published. A broken
        // external admission releaser must not create an unhandled rejection
        // or leave the job marked as owning capacity.
      }
    });
  }

  #captureFirstError(captured: CapturedError, error: unknown): void {
    if (captured.present) return;
    captured.error = error;
    captured.present = true;
  }

  #notify(job: SourceJob, result: OrdinaryTextureSourceResult): void {
    const listeners = [...job.listeners.entries()];
    for (const [key, subscriber] of listeners) {
      if (job.listeners.get(key) === subscriber) this.#notifyListener(job, key, subscriber, result);
    }
  }

  #notifyListener(
    job: SourceJob,
    key: number,
    subscriber: SourceSubscriber,
    result: OrdinaryTextureSourceResult,
  ): void {
    if (subscriber.released || subscriber.notifying) return;
    subscriber.deliveryFailed = false;
    subscriber.notifying = true;
    try {
      subscriber.listener(result);
      subscriber.consecutiveFailures = 0;
    } catch (error) {
      if (!subscriber.released && job.listeners.get(key) === subscriber) {
        subscriber.consecutiveFailures += 1;
        subscriber.deliveryFailed = true;
        this.#deliveryFailures += 1;
        try {
          subscriber.onDeliveryFailure?.({
            attempt: subscriber.consecutiveFailures,
            error,
            request: subscriber.request,
            result,
            retry: () => this.#retrySubscriber(job, key, subscriber),
            terminate: () => this.#releaseSubscriber(job, key, subscriber),
          });
        } catch {
          // Failure reporting is external too; it cannot disrupt peers or store ownership.
        }
      }
    } finally {
      subscriber.notifying = false;
    }
  }

  #releaseSubscriber(job: SourceJob, key: number, subscriber: SourceSubscriber): void {
    if (subscriber.released) return;
    subscriber.released = true;
    const current = this.#jobs.get(job.key);
    if (current !== job || current.listeners.get(key) !== subscriber) return;
    current.listeners.delete(key);
    if (current.listeners.size !== 0) return;
    this.#jobs.delete(job.key);
    if (!current.settled) {
      current.controller.abort();
      this.#aborts += 1;
      return;
    }
    this.#releaseSource(current);
  }

  #retrySubscriber(job: SourceJob, key: number, subscriber: SourceSubscriber): boolean {
    if (
      this.#disposed
      || subscriber.released
      || subscriber.notifying
      || !subscriber.deliveryFailed
      || this.#jobs.get(job.key) !== job
      || job.listeners.get(key) !== subscriber
      || job.result === undefined
    ) return false;
    this.#notifyListener(job, key, subscriber, job.result);
    return true;
  }

  #releaseSource(job: SourceJob): void {
    const lease = job.lease;
    const source = job.source;
    delete job.lease;
    delete job.source;
    if (lease !== undefined && source !== undefined && lease.release()) this.#close(source);
  }

  #settleError(job: SourceJob, error: unknown): void {
    job.settled = true;
    this.#failures += 1;
    const result: OrdinaryTextureSourceResult = { error, kind: "error" };
    job.result = result;
    this.#notify(job, result);
  }
}
