import { vi } from "vitest";

export type Deferred<Value> = {
  readonly promise: Promise<Value>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: Value) => void;
};

export const deferred = <Value>(): Deferred<Value> => {
  let reject!: (error: unknown) => void;
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
};

export const flushMicrotasks = async (turns = 8): Promise<void> => {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
};

export const installAnimationFrameQueue = (): FrameRequestCallback[] => {
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  return callbacks;
};

export const drainAnimationFrames = (
  callbacks: FrameRequestCallback[],
  firstTimestamp = 16,
): void => {
  for (const [index, callback] of callbacks.splice(0).entries()) callback(firstTimestamp + index);
};

export const flushAnimationFrames = async (
  callbacks: FrameRequestCallback[],
  options: { readonly firstTimestamp?: number; readonly microtaskTurns?: number } = {},
): Promise<void> => {
  drainAnimationFrames(callbacks, options.firstTimestamp);
  await flushMicrotasks(options.microtaskTurns);
};
