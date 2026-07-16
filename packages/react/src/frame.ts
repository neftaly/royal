import { createContext, useContext, useEffect, type Context } from "react";
import { useCommittedRef } from "./committed-ref";
import {
  validateUseFrameCallback,
  validateUseFrameOptions,
  type FrameCallback,
  type FrameLoop,
  type UseFrameOptions,
} from "./frame-loop";

export {
  createFrameLoop,
  validateUseFrameCallback,
  validateUseFrameOptions,
} from "./frame-loop";
export type {
  FrameCallback,
  FrameLoop,
  FrameLoopErrorHandler,
  FrameSnapshot,
  UseFrameOptions,
} from "./frame-loop";

export const FrameLoopContext: Context<FrameLoop | null> = createContext<FrameLoop | null>(null);

const useCanvasFrameLoop = (): FrameLoop => {
  const frameLoop = useContext(FrameLoopContext);
  if (frameLoop === null) throw new Error("useFrame must be used inside <Canvas>");
  return frameLoop;
};

const useFrameSubscription = (
  callback: FrameCallback,
  { active = true, priority = 0 }: UseFrameOptions,
): void => {
  const frameLoop = useCanvasFrameLoop();
  const callbackRef = useCommittedRef(callback);
  useEffect(() => active
    ? frameLoop.subscribe((frame) => callbackRef.current(frame), priority)
    : undefined, [active, frameLoop, priority]);
};

/** Runs on every active Canvas frame in ascending priority order. */
export const useFrame = (callback: FrameCallback, options: UseFrameOptions = {}): void => {
  validateUseFrameCallback(callback);
  validateUseFrameOptions(options);
  useFrameSubscription(callback, options);
};
