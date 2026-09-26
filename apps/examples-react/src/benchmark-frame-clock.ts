/** RAF timestamps describe the frame start, not when its callback actually runs. */
export const nextBenchmarkFrame = (deadline: number): Promise<number | null> =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (value: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cancelAnimationFrame(frame);
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), Math.max(1, deadline - performance.now()));
    const frame = requestAnimationFrame(() => {
      const now = performance.now();
      finish(now < deadline ? now : null);
    });
  });

/** Include synchronous input work and wait until Royal has rendered the change. */
export const measureCameraFrame = async (
  move: () => void,
  rendererFrame: () => number | undefined,
  deadline: number,
): Promise<number | null> => {
  const before = rendererFrame();
  const start = performance.now();
  move();
  do {
    if (await nextBenchmarkFrame(deadline) === null) return null;
  } while (before === undefined || rendererFrame() === before);
  return performance.now() - start;
};
