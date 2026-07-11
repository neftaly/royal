import type { TextureContentKey, TextureVersion } from "@royal/renderer-core";
import type { ResourceArenaSourceLease } from "./resource-arena";
import type { LoadedTextureSource } from "./texture-sources";

export interface OrdinaryTextureSourceRequest {
  readonly contentKey?: TextureContentKey;
  readonly uri: string;
  readonly version?: TextureVersion;
}

export type OrdinaryTextureSourceResult =
  | { readonly kind: "ready"; readonly source: LoadedTextureSource }
  | { readonly error: unknown; readonly kind: "error" };

export interface OrdinaryTextureSourceSubscription {
  release(): void;
}

export interface OrdinaryTextureSourceStoreSnapshot {
  readonly aborts: number;
  readonly activeJobs: number;
  readonly failures: number;
  readonly starts: number;
  readonly subscribers: number;
  readonly successes: number;
}

type SourceJob = {
  readonly controller: AbortController;
  readonly key: string;
  lease?: ResourceArenaSourceLease;
  readonly listeners: Map<number, (result: OrdinaryTextureSourceResult) => void>;
  result?: OrdinaryTextureSourceResult;
  settled: boolean;
  source?: LoadedTextureSource;
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
  readonly #close: (source: LoadedTextureSource) => void;
  readonly #jobs = new Map<string, SourceJob>();
  readonly #load: (request: OrdinaryTextureSourceRequest, signal: AbortSignal) => Promise<LoadedTextureSource>;
  readonly #retain: (source: LoadedTextureSource) => ResourceArenaSourceLease;
  #aborts = 0;
  #failures = 0;
  #nextListener = 1;
  #starts = 0;
  #subscribers = 0;
  #successes = 0;

  constructor(options: {
    readonly close: (source: LoadedTextureSource) => void;
    readonly load: (request: OrdinaryTextureSourceRequest, signal: AbortSignal) => Promise<LoadedTextureSource>;
    readonly retain: (source: LoadedTextureSource) => ResourceArenaSourceLease;
  }) {
    this.#close = options.close;
    this.#load = options.load;
    this.#retain = options.retain;
  }

  acquire(
    request: OrdinaryTextureSourceRequest,
    listener: (result: OrdinaryTextureSourceResult) => void,
  ): OrdinaryTextureSourceSubscription {
    const key = ordinaryTextureSourceKey(request);
    let job = this.#jobs.get(key);
    let start = false;
    if (job === undefined) {
      job = { controller: new AbortController(), key, listeners: new Map(), settled: false };
      this.#jobs.set(key, job);
      this.#starts += 1;
      start = true;
    }

    const listenerKey = this.#nextListener;
    this.#nextListener += 1;
    job.listeners.set(listenerKey, listener);
    this.#subscribers += 1;
    if (start) this.#start(job, request);
    if (job.result !== undefined) listener(job.result);

    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        const current = this.#jobs.get(key);
        if (current === undefined || !current.listeners.delete(listenerKey)) return;
        this.#subscribers -= 1;
        if (current.listeners.size !== 0) return;
        this.#jobs.delete(key);
        if (!current.settled) {
          current.controller.abort();
          this.#aborts += 1;
          return;
        }
        if (current.source !== undefined && current.lease?.release() === true) this.#close(current.source);
      },
    };
  }

  dispose(): void {
    for (const job of this.#jobs.values()) {
      this.#subscribers -= job.listeners.size;
      job.listeners.clear();
      if (!job.settled) {
        job.controller.abort();
        this.#aborts += 1;
      } else if (job.source !== undefined && job.lease?.release() === true) {
        this.#close(job.source);
      }
    }
    this.#jobs.clear();
  }

  snapshot(): OrdinaryTextureSourceStoreSnapshot {
    return {
      aborts: this.#aborts,
      activeJobs: this.#jobs.size,
      failures: this.#failures,
      starts: this.#starts,
      subscribers: this.#subscribers,
      successes: this.#successes,
    };
  }

  #start(job: SourceJob, request: OrdinaryTextureSourceRequest): void {
    let pending: Promise<LoadedTextureSource>;
    try {
      pending = this.#load(request, job.controller.signal);
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then((source) => {
      if (this.#jobs.get(job.key) !== job || job.listeners.size === 0) {
        this.#close(source);
        return;
      }
      job.settled = true;
      job.source = source;
      job.lease = this.#retain(source);
      this.#successes += 1;
      const result: OrdinaryTextureSourceResult = { kind: "ready", source };
      job.result = result;
      for (const listener of job.listeners.values()) listener(result);
    }, (error: unknown) => {
      if (this.#jobs.get(job.key) !== job || job.listeners.size === 0) return;
      job.settled = true;
      this.#failures += 1;
      const result: OrdinaryTextureSourceResult = { error, kind: "error" };
      job.result = result;
      for (const listener of job.listeners.values()) listener(result);
    });
  }
}
