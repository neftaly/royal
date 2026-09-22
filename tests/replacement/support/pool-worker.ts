import { vi } from "vitest";

/** Exercises the real workerpool host against a controllable browser transport. */
export class PoolWorker extends EventTarget {
  static instances: PoolWorker[] = [];
  static execute: ((worker: PoolWorker, message: PoolRequest) => void) | undefined;
  readonly requests: PoolRequest[] = [];
  readonly terminate = vi.fn();
  fail = "";
  constructor() {
    super();
    PoolWorker.instances.push(this);
    queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: "ready" })));
  }
  postMessage = vi.fn((message: PoolRequest | string, _transfer?: Transferable[]) => {
    if (typeof message === "string") return;
    if (message.method === this.fail) throw new Error("Worker transport failed");
    this.requests.push(message);
    PoolWorker.execute?.(this, message);
  });
  reply(request: PoolRequest, result?: unknown, error?: string): void {
    this.dispatchEvent(new MessageEvent("message", { data: {
      id: request.id, result, error: error === undefined ? null : { message: error, name: "Error" },
    } }));
  }
}
export type PoolRequest = { id: number; method: string; params: any[] };
