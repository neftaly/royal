import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FrameCallback, FrameLoop } from '../src/frame';

type Cleanup = () => void;
type MockContext<Value> = {
  current: Value;
};

const importFrameWithMockedReact = async (): Promise<{
  readonly createFrameLoop: () => FrameLoop;
  readonly FrameLoopContext: MockContext<FrameLoop | null>;
  readonly cleanups: Cleanup[];
  readonly stateUpdates: unknown[];
  readonly useFrame: (callback: FrameCallback, priority?: number) => void;
  readonly useFrameIndex: () => number;
}> => {
  const cleanups: Cleanup[] = [];
  const stateUpdates: unknown[] = [];

  vi.resetModules();
  vi.doMock('react', () => ({
    createContext: <Value>(value: Value) => ({ current: value }),
    useContext: <Value>(context: MockContext<Value>) => context.current,
    useEffect: (effect: () => void | Cleanup) => {
      const cleanup = effect();
      if (cleanup !== undefined) {
        cleanups.push(cleanup);
      }
    },
    useRef: <Value>(value: Value) => ({ current: value }),
    useState: <Value>(initial: Value | (() => Value)) => {
      let state = typeof initial === 'function'
        ? (initial as () => Value)()
        : initial;
      const setState = (next: Value | ((current: Value) => Value)): void => {
        state = typeof next === 'function'
          ? (next as (current: Value) => Value)(state)
          : next;
        stateUpdates.push(state);
      };

      return [state, setState] as const;
    },
  }));

  const frame = await import('../src/frame');

  return {
    createFrameLoop: frame.createFrameLoop,
    FrameLoopContext: frame.FrameLoopContext as unknown as MockContext<FrameLoop | null>,
    cleanups,
    stateUpdates,
    useFrame: frame.useFrame,
    useFrameIndex: frame.useFrameIndex,
  };
};

const installFrameEnvironment = (): {
  readonly cancelAnimationFrame: ReturnType<typeof vi.fn<(handle: number) => void>>;
  readonly flushFrame: (timestamp: number) => void;
  readonly pending: Map<number, FrameRequestCallback>;
  readonly requestAnimationFrame: ReturnType<typeof vi.fn<(callback: FrameRequestCallback) => number>>;
} => {
  let nextHandle = 1;
  const pending = new Map<number, FrameRequestCallback>();
  const requestAnimationFrame = vi.fn((callback: FrameRequestCallback): number => {
    const handle = nextHandle;
    nextHandle += 1;
    pending.set(handle, callback);
    return handle;
  });
  const cancelAnimationFrame = vi.fn((handle: number): void => {
    pending.delete(handle);
  });

  vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
  vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);

  const flushFrame = (timestamp: number): void => {
    const entry = pending.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (entry === undefined) {
      throw new Error('No pending frame');
    }

    const [handle, callback] = entry;
    pending.delete(handle);
    callback(timestamp);
  };

  return {
    cancelAnimationFrame,
    flushFrame,
    pending,
    requestAnimationFrame,
  };
};

afterEach(() => {
  vi.doUnmock('react');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('frame hooks', () => {
  it('subscribes callbacks to RAF frame snapshots', async () => {
    const frameEnvironment = installFrameEnvironment();
    const { cleanups, useFrame } = await importFrameWithMockedReact();
    const callback = vi.fn<FrameCallback>();

    useFrame(callback);

    expect(frameEnvironment.requestAnimationFrame).toHaveBeenCalledTimes(1);

    frameEnvironment.flushFrame(100);
    frameEnvironment.flushFrame(116);

    expect(callback).toHaveBeenNthCalledWith(1, {
      delta: 0,
      index: 1,
      timestamp: 100,
    });
    expect(callback).toHaveBeenNthCalledWith(2, {
      delta: 16,
      index: 2,
      timestamp: 116,
    });
    expect(frameEnvironment.requestAnimationFrame).toHaveBeenCalledTimes(3);

    expect(cleanups).toHaveLength(1);
    cleanups[0]!();

    expect(frameEnvironment.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(frameEnvironment.pending.size).toBe(0);
  });

  it('runs lower-priority frame callbacks first and preserves subscription order for ties', async () => {
    const frameEnvironment = installFrameEnvironment();
    const { cleanups, useFrame } = await importFrameWithMockedReact();
    const calls: string[] = [];

    useFrame(() => {
      calls.push('default');
    });
    useFrame(() => {
      calls.push('late');
    }, 10);
    useFrame(() => {
      calls.push('early');
    }, -10);
    useFrame(() => {
      calls.push('default-tie');
    });

    frameEnvironment.flushFrame(20);

    expect(calls).toEqual(['early', 'default', 'default-tie', 'late']);

    for (const cleanup of cleanups) {
      cleanup();
    }
  });

  it('scopes frame subscriptions to the current frame loop context', async () => {
    const frameEnvironment = installFrameEnvironment();
    const {
      createFrameLoop,
      FrameLoopContext,
      cleanups,
      useFrame,
    } = await importFrameWithMockedReact();
    const firstLoop = createFrameLoop();
    const secondLoop = createFrameLoop();
    const first = vi.fn<FrameCallback>();
    const second = vi.fn<FrameCallback>();

    FrameLoopContext.current = firstLoop;
    useFrame(first);
    FrameLoopContext.current = secondLoop;
    useFrame(second);

    frameEnvironment.flushFrame(100);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    frameEnvironment.flushFrame(100);
    expect(second).toHaveBeenCalledTimes(1);

    for (const cleanup of cleanups) {
      cleanup();
    }
    firstLoop.dispose();
    secondLoop.dispose();
  });

  it('exposes frame count state through useFrameIndex only', async () => {
    const frameEnvironment = installFrameEnvironment();
    const { stateUpdates, useFrameIndex } = await importFrameWithMockedReact();

    expect(useFrameIndex()).toBe(0);

    frameEnvironment.flushFrame(40);
    frameEnvironment.flushFrame(56);

    expect(stateUpdates).toEqual([1, 2]);
  });
});
