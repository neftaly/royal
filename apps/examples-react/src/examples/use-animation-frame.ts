import { useEffect, useRef } from 'react';

/** Example-shell clock; renderer mutations remain responsible for invalidation. */
export const useAnimationFrame = (update: (elapsedSeconds: number) => void): void => {
  const updateRef = useRef(update);
  updateRef.current = update;

  useEffect(() => {
    let active = true;
    let frame = 0;
    let startedAt: number | undefined;
    const tick = (time: number): void => {
      if (!active) return;
      startedAt ??= time;
      updateRef.current((time - startedAt) / 1_000);
      frame = globalThis.requestAnimationFrame(tick);
    };
    frame = globalThis.requestAnimationFrame(tick);
    return () => {
      active = false;
      globalThis.cancelAnimationFrame(frame);
    };
  }, []);
};
