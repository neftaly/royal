import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureCameraFrame, nextBenchmarkFrame } from '../../apps/examples-react/src/benchmark-frame-clock';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const clock = () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let now = 100;
  const callbacks: FrameRequestCallback[] = [];
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => callbacks.push(callback));
  const cancel = vi.fn();
  vi.stubGlobal('cancelAnimationFrame', cancel);
  return { cancel, set: (value: number) => { now = value; },
    frame: async (value: number) => {
      now = value;
      callbacks.shift()!(90); // Frame timestamp predates the input and synchronous work.
      await Promise.resolve(); await Promise.resolve();
    },
  };
};

describe('benchmark render clock', () => {
  it('uses callback execution time instead of a stale RAF timestamp', async () => {
    const c = clock();
    const sample = nextBenchmarkFrame(1000);
    await c.frame(340);
    expect(await sample).toBe(340);
  });

  it('includes synchronous input work and waits for the renderer to advance', async () => {
    const c = clock();
    let frame = 4;
    const sample = measureCameraFrame(() => c.set(300), () => frame, 1000);
    await c.frame(310);
    frame++;
    await c.frame(330);
    expect(await sample).toBe(230);
  });

  it('bounds missing renderer progress and cancels its pending RAF', async () => {
    const c = clock();
    const sample = measureCameraFrame(() => {}, () => 4, 150);
    await c.frame(110);
    await vi.advanceTimersByTimeAsync(50);
    expect(await sample).toBeNull();
    expect(c.cancel).toHaveBeenCalledTimes(2);
  });

  it('rejects a frame that executes after the deadline', async () => {
    const c = clock();
    const sample = nextBenchmarkFrame(150);
    await c.frame(160);
    expect(await sample).toBeNull();
  });
});
