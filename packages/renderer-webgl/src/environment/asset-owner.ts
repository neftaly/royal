import type { PrefilteredEnvironmentLight } from "@royal/renderer-core";
import type { PreparedRoyalEnvironment } from "./royal-environment-ktx1";
import type { AsyncPreparationScheduler } from "../resource/async-preparation-owner";
import { KeyedRetainedListeners } from "../resource/retained-listeners";

export type PrefilteredEnvironmentAssetSnapshot =
  | Readonly<{ state: "idle" }>
  | Readonly<{ state: "loading" }>
  | Readonly<{
    mipCount: number;
    provenance: string;
    size: number;
    state: "ready";
  }>
  | Readonly<{ error: string; state: "error" }>;

export type PrefilteredEnvironmentAssetOwnerOptions = Readonly<{
  onAssetChanged: () => void;
  onListenerError: (error: unknown) => void;
  prepare?: (source: ArrayBuffer) => Promise<PreparedRoyalEnvironment>;
  read?: (src: string, signal: AbortSignal) => Promise<ArrayBuffer>;
  schedule?: AsyncPreparationScheduler;
}>;

type ActiveEnvironment = {
  readonly controller: AbortController;
  readonly key: string;
  prepared?: PreparedRoyalEnvironment;
  snapshot: PrefilteredEnvironmentAssetSnapshot;
};

const IDLE: PrefilteredEnvironmentAssetSnapshot = { state: "idle" };

export const prefilteredEnvironmentAssetKey = (
  environment: Pick<PrefilteredEnvironmentLight, "src" | "version">,
): string => JSON.stringify([
  environment.src,
  environment.version === undefined
    ? null
    : [typeof environment.version, String(environment.version)],
]);

const failureMessage = (failure: unknown): string => {
  const message = failure instanceof Error
    ? failure.message
    : typeof failure === "string" ? failure : "unknown environment loading error";
  return message.length <= 400 ? message : `${message.slice(0, 399)}…`;
};

const readWithFetch = async (src: string, signal: AbortSignal): Promise<ArrayBuffer> => {
  const response = await fetch(src, { signal });
  if (!response.ok) throw new Error(`request failed with HTTP ${response.status}`);
  return response.arrayBuffer();
};

const prepareLazily = async (source: ArrayBuffer): Promise<PreparedRoyalEnvironment> => {
  const { parseRoyalEnvironmentKtx1 } = await import("./royal-environment-ktx1");
  return parseRoyalEnvironmentKtx1(source);
};

const prepareDirectly: AsyncPreparationScheduler = (_signal, prepare) => prepare();

/** Owns transport, identity, cancellation, and observation around the pure artifact parser. */
export class PrefilteredEnvironmentAssetOwner {
  #active: ActiveEnvironment | undefined;
  #disposed = false;
  readonly #listeners = new KeyedRetainedListeners<string>();
  readonly #options: Required<PrefilteredEnvironmentAssetOwnerOptions>;

  constructor(options: PrefilteredEnvironmentAssetOwnerOptions) {
    this.#options = {
      ...options,
      prepare: options.prepare ?? prepareLazily,
      read: options.read ?? readWithFetch,
      schedule: options.schedule ?? prepareDirectly,
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#active?.controller.abort();
    this.#active = undefined;
    this.#listeners.clear();
  }

  getSnapshot(
    environment: Pick<PrefilteredEnvironmentLight, "src" | "version">,
  ): PrefilteredEnvironmentAssetSnapshot {
    return this.#active?.key === prefilteredEnvironmentAssetKey(environment)
      ? this.#active.snapshot
      : IDLE;
  }

  prepared(
    environment: Pick<PrefilteredEnvironmentLight, "src" | "version">,
  ): PreparedRoyalEnvironment | undefined {
    return this.#active?.key === prefilteredEnvironmentAssetKey(environment)
      ? this.#active.prepared
      : undefined;
  }

  reconcile(
    environment: Pick<PrefilteredEnvironmentLight, "src" | "version"> | undefined,
  ): void {
    if (this.#disposed) return;
    if (environment === undefined) {
      const previous = this.#active;
      previous?.controller.abort();
      this.#active = undefined;
      if (previous !== undefined) this.#publish(previous.key);
      return;
    }
    const key = prefilteredEnvironmentAssetKey(environment);
    if (this.#active?.key === key) return;
    const previous = this.#active;
    previous?.controller.abort();
    const active: ActiveEnvironment = {
      controller: new AbortController(),
      key,
      snapshot: { state: "loading" },
    };
    this.#active = active;
    if (previous !== undefined) this.#publish(previous.key);
    this.#publish(key);
    void this.#load(active, environment.src);
  }

  subscribe(
    environment: Pick<PrefilteredEnvironmentLight, "src" | "version">,
    listener: () => void,
  ): () => void {
    if (typeof listener !== "function") {
      throw new TypeError("Royal prefiltered environment subscriber must be a function");
    }
    if (this.#disposed) return () => undefined;
    const key = prefilteredEnvironmentAssetKey(environment);
    return this.#listeners.subscribe(key, listener);
  }

  #publish(key: string): void {
    this.#listeners.publish(key, this.#options.onListenerError);
  }

  async #load(active: ActiveEnvironment, src: string): Promise<void> {
    let prepared = false;
    try {
      const result = await this.#options.schedule(active.controller.signal, async () => {
        const source = await this.#options.read(src, active.controller.signal);
        return this.#options.prepare(source);
      });
      if (this.#disposed || this.#active !== active || active.controller.signal.aborted) return;
      active.prepared = result;
      active.snapshot = {
        mipCount: result.levels.length,
        provenance: result.metadata.provenance,
        size: result.size,
        state: "ready",
      };
      prepared = true;
    } catch (failure) {
      if (this.#disposed || this.#active !== active || active.controller.signal.aborted) return;
      active.snapshot = { error: failureMessage(failure), state: "error" };
    }
    if (prepared) this.#options.onAssetChanged();
    this.#publish(active.key);
  }
}
