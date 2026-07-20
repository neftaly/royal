import { vi } from "vitest";

/**
 * Wait for lifecycle work that advances through promises or queued callbacks.
 *
 * Vitest's browser-oriented 50 ms default polling interval needlessly slows
 * these deterministic unit harnesses. Keep its useful retry and timeout
 * semantics, but poll closely enough to follow the next microtask turn.
 */
export const waitFor = <T>(callback: () => T | Promise<T>): Promise<T> =>
  vi.waitFor(callback, { interval: 1 });
