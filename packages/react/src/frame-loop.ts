import { recordWithAllowedFields } from "./validation";

/**
 * Callback-scoped values backed by one reused frame-loop object. Copy the
 * scalar fields if they must be retained after the callback returns.
 */
export interface FrameSnapshot {
  readonly deltaMs: number;
  /** Seconds elapsed since the current active run's first frame. */
  readonly elapsedSeconds: number;
  readonly frameIndex: number;
  readonly timestampMs: number;
}

type MutableFrameSnapshot = {
  -readonly [Key in keyof FrameSnapshot]: FrameSnapshot[Key];
};

export type FrameCallback = (frame: FrameSnapshot) => void;

/** Scheduling controls for one Canvas frame subscription. */
export interface UseFrameOptions {
  /** Releases the frame subscription and renderer clock while false. @defaultValue `true` */
  readonly active?: boolean;
  /** Lower priorities run first; equal priorities retain subscription order. @defaultValue `0` */
  readonly priority?: number;
}

const USE_FRAME_OPTION_FIELDS = ["active", "priority"] as const;

/** @internal Validates the public hook boundary without allocating normalized options. */
export const validateUseFrameOptions = (options: UseFrameOptions): void => {
  recordWithAllowedFields(options, USE_FRAME_OPTION_FIELDS, "useFrame options", "option");
  if (options.active !== undefined && typeof options.active !== "boolean") {
    throw new TypeError("useFrame active must be a boolean");
  }
  if (options.priority !== undefined && !Number.isFinite(options.priority)) {
    throw new TypeError("useFrame priority must be a finite number");
  }
};

/** @internal Validates the public hook boundary before subscribing an effect. */
export const validateUseFrameCallback = (callback: unknown): void => {
  if (typeof callback !== "function") {
    throw new TypeError("useFrame callback must be a function");
  }
};

type FrameSubscriber = {
  active: boolean;
  readonly callback: FrameCallback;
  readonly order: number;
  readonly priority: number;
};

export type FrameLoop = {
  afterFrame(callback: () => void): () => void;
  dispose(): void;
  /** Observes transitions between a static Canvas and an active frame run. */
  observeActivity(callback: (active: boolean) => void): () => void;
  /** Pauses without removing subscribers or releasing activity ownership; resume starts a fresh timing run. */
  setPaused(paused: boolean): void;
  subscribe(callback: FrameCallback, priority: number): () => void;
};

export type FrameLoopErrorHandler = (error: unknown) => void;

const canUseFrameLoop = (): boolean =>
  typeof requestAnimationFrame === 'function' &&
  typeof cancelAnimationFrame === 'function';

export const createFrameLoop = (reportError: FrameLoopErrorHandler): FrameLoop => {
  const afterFrameCallbacks = new Map<object, () => void>();
  const activityObservers = new Map<object, (active: boolean) => void>();
  const frame: MutableFrameSnapshot = {
    deltaMs: 0,
    elapsedSeconds: 0,
    frameIndex: 0,
    timestampMs: 0,
  };
  const subscribers: FrameSubscriber[] = [];
  let animationFrame: number | undefined;
  let activeSubscriberCount = 0;
  let frameIndex = 0;
  let lastTimestamp: number | undefined;
  let nextSubscriberOrder = 0;
  let paused = false;
  let reportedActive = false;
  let runningFrame = false;
  let sortPending = false;
  let startTimestamp: number | undefined;

  const sortSubscribers = (): void => {
    subscribers.sort((left, right) =>
      left.priority - right.priority || left.order - right.order
    );
  };

  const compactSubscribers = (): void => {
    let writeIndex = 0;
    for (let readIndex = 0; readIndex < subscribers.length; readIndex += 1) {
      const subscriber = subscribers[readIndex]!;
      if (!subscriber.active) continue;
      subscribers[writeIndex] = subscriber;
      writeIndex += 1;
    }
    subscribers.length = writeIndex;
    if (sortPending) {
      sortPending = false;
      sortSubscribers();
    }
  };

  const stop = (): void => {
    if (animationFrame !== undefined && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(animationFrame);
    }

    animationFrame = undefined;
    frameIndex = 0;
    lastTimestamp = undefined;
    startTimestamp = undefined;
  };

  const notifyActivity = (active: boolean): void => {
    reportedActive = active;
    let firstFailure: unknown;
    let failed = false;
    for (const [token, observer] of activityObservers) {
      try {
        observer(active);
      } catch (error) {
        activityObservers.delete(token);
        if (!failed) firstFailure = error;
        failed = true;
      }
    }
    if (failed) reportError(firstFailure);
  };

  const syncActivity = (): void => {
    const active = activeSubscriberCount > 0;
    // Keep renderer-clock ownership through the after-frame phase. It consumes
    // mutations made by a subscriber before the static demand clock resumes.
    if (!active && runningFrame) return;
    if (active !== reportedActive) notifyActivity(active);
  };

  const schedule = (): void => {
    if (
      activeSubscriberCount === 0 ||
      paused ||
      animationFrame !== undefined ||
      !canUseFrameLoop()
    ) return;

    animationFrame = requestAnimationFrame(runFrame);
  };

  const runFrame = (timestamp: number): void => {
    animationFrame = undefined;

    if (paused || activeSubscriberCount === 0) {
      lastTimestamp = undefined;
      startTimestamp = undefined;
      return;
    }

    frameIndex += 1;
    startTimestamp ??= timestamp;
    frame.deltaMs = lastTimestamp === undefined ? 0 : timestamp - lastTimestamp;
    frame.elapsedSeconds = (timestamp - startTimestamp) / 1000;
    frame.frameIndex = frameIndex;
    frame.timestampMs = timestamp;
    lastTimestamp = timestamp;

    // Register the next timing tick before subscribers run so one failing
    // subscriber cannot stop the loop. Canvas flushes renderer mutations in
    // the after-frame phase below, after every subscriber has run.
    schedule();
    runningFrame = true;
    try {
      const capturedSubscriberCount = subscribers.length;
      for (let index = 0; index < capturedSubscriberCount; index += 1) {
        const subscriber = subscribers[index];
        if (subscriber?.active) {
          try {
            subscriber.callback(frame);
          } catch (error) {
            subscriber.active = false;
            activeSubscriberCount -= 1;
            reportError(error);
          }
        }
      }
    } finally {
      try {
        let afterFrameError: unknown;
        let afterFrameFailed = false;
        for (const callback of afterFrameCallbacks.values()) {
          try {
            callback();
          } catch (error) {
            if (!afterFrameFailed) afterFrameError = error;
            afterFrameFailed = true;
          }
        }
        if (afterFrameFailed) reportError(afterFrameError);
      } finally {
        runningFrame = false;
        compactSubscribers();
        if (activeSubscriberCount === 0) stop();
        syncActivity();
      }
    }
  };

  return {
    afterFrame: (callback) => {
      const token = {};
      afterFrameCallbacks.set(token, callback);

      return () => {
        afterFrameCallbacks.delete(token);
      };
    },
    dispose: () => {
      const wasActive = activeSubscriberCount > 0;
      for (const subscriber of subscribers) {
        subscriber.active = false;
      }
      subscribers.length = 0;
      activeSubscriberCount = 0;
      afterFrameCallbacks.clear();
      stop();
      runningFrame = false;
      if (wasActive || reportedActive) notifyActivity(false);
      activityObservers.clear();
    },
    observeActivity: (callback) => {
      const token = {};
      activityObservers.set(token, callback);
      try {
        callback(activeSubscriberCount > 0);
      } catch (error) {
        activityObservers.delete(token);
        throw error;
      }

      return () => {
        activityObservers.delete(token);
      };
    },
    setPaused: (nextPaused) => {
      if (paused === nextPaused) return;
      paused = nextPaused;
      if (paused) stop();
      else schedule();
    },
    subscribe: (callback, priority) => {
      const wasInactive = activeSubscriberCount === 0;
      const subscriber: FrameSubscriber = {
        active: true,
        callback,
        order: nextSubscriberOrder,
        priority
      };
      nextSubscriberOrder += 1;

      subscribers.push(subscriber);
      activeSubscriberCount += 1;
      if (runningFrame) sortPending = true;
      else sortSubscribers();
      if (wasInactive) syncActivity();
      schedule();

      return () => {
        if (!subscriber.active) return;

        subscriber.active = false;
        activeSubscriberCount -= 1;
        if (runningFrame) {
          if (activeSubscriberCount === 0) stop();
          return;
        }
        const index = subscribers.indexOf(subscriber);
        if (index === -1) return;

        subscribers.splice(index, 1);

        if (activeSubscriberCount === 0) {
          stop();
          syncActivity();
        }
      };
    }
  };
};
