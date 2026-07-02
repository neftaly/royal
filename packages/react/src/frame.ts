import { createContext, useContext, useEffect, useRef, useState } from 'react';

export interface FrameSnapshot {
  readonly delta: number;
  /** Seconds elapsed since this frame loop started. */
  readonly elapsed: number;
  readonly index: number;
  readonly timestamp: number;
}

export type FrameCallback = (frame: FrameSnapshot) => void;

type FrameSubscriber = {
  readonly callback: FrameCallback;
  readonly order: number;
  readonly priority: number;
};

export type FrameLoop = {
  dispose(): void;
  frameIndex(): number;
  subscribe(callback: FrameCallback, priority: number): () => void;
};

const canUseFrameLoop = (): boolean =>
  typeof requestAnimationFrame === 'function' &&
  typeof cancelAnimationFrame === 'function';

export const createFrameLoop = (): FrameLoop => {
  const subscribers: FrameSubscriber[] = [];
  let animationFrame: number | undefined;
  let frameIndex = 0;
  let lastTimestamp: number | undefined;
  let nextSubscriberOrder = 0;
  let startTimestamp: number | undefined;

  const sortSubscribers = (): void => {
    subscribers.sort((left, right) =>
      left.priority - right.priority || left.order - right.order
    );
  };

  const stop = (): void => {
    if (animationFrame !== undefined && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(animationFrame);
    }

    animationFrame = undefined;
    lastTimestamp = undefined;
    startTimestamp = undefined;
  };

  const schedule = (): void => {
    if (animationFrame !== undefined || !canUseFrameLoop()) return;

    animationFrame = requestAnimationFrame(runFrame);
  };

  const runFrame = (timestamp: number): void => {
    animationFrame = undefined;

    if (subscribers.length === 0) {
      lastTimestamp = undefined;
      startTimestamp = undefined;
      return;
    }

    frameIndex += 1;
    startTimestamp ??= timestamp;
    const frame = {
      delta: lastTimestamp === undefined ? 0 : timestamp - lastTimestamp,
      elapsed: (timestamp - startTimestamp) / 1000,
      index: frameIndex,
      timestamp
    } satisfies FrameSnapshot;
    lastTimestamp = timestamp;

    const frameSubscribers = Array.from(subscribers);
    for (const subscriber of frameSubscribers) {
      if (subscribers.includes(subscriber)) {
        subscriber.callback(frame);
      }
    }

    schedule();
  };

  return {
    dispose: () => {
      subscribers.length = 0;
      stop();
    },
    frameIndex: () => frameIndex,
    subscribe: (callback, priority) => {
      const subscriber = {
        callback,
        order: nextSubscriberOrder,
        priority
      } satisfies FrameSubscriber;
      nextSubscriberOrder += 1;

      subscribers.push(subscriber);
      sortSubscribers();
      schedule();

      return () => {
        const index = subscribers.indexOf(subscriber);
        if (index === -1) return;

        subscribers.splice(index, 1);

        if (subscribers.length === 0) {
          stop();
        }
      };
    }
  };
};

export const FrameLoopContext = createContext<FrameLoop | null>(null);

const useCanvasFrameLoop = (): FrameLoop => {
  const frameLoop = useContext(FrameLoopContext);
  if (frameLoop === null) {
    throw new Error("Royal frame hooks must be used inside Canvas");
  }

  return frameLoop;
};

export const useFrame = (callback: FrameCallback, priority = 0): void => {
  const frameLoop = useCanvasFrameLoop();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => frameLoop.subscribe((frame) => {
    callbackRef.current(frame);
  }, priority), [frameLoop, priority]);
};

export const useFrameIndex = (): number => {
  const frameLoop = useCanvasFrameLoop();
  const [index, setIndex] = useState(() => frameLoop.frameIndex());

  useFrame((frame) => {
    setIndex(frame.index);
  });

  return index;
};
