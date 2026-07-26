export const FRAME_CLOCK_EFFECT_NONE = 0 as const;
export const FRAME_CLOCK_EFFECT_RENDER = 1 as const;
export const FRAME_CLOCK_EFFECT_SCHEDULE = 2 as const;

export const FRAME_CLOCK_EVENT_ACQUIRE_EXTERNAL = 0 as const;
export const FRAME_CLOCK_EVENT_CONTEXT_BLOCKED = 1 as const;
export const FRAME_CLOCK_EVENT_CONTEXT_RESUMED = 2 as const;
export const FRAME_CLOCK_EVENT_DISPOSE = 3 as const;
export const FRAME_CLOCK_EVENT_FLUSH_INTERNAL = 4 as const;
export const FRAME_CLOCK_EVENT_INVALIDATE = 5 as const;
export const FRAME_CLOCK_EVENT_RELEASE_EXTERNAL = 6 as const;
export const FRAME_CLOCK_EVENT_RENDER_FAILED = 7 as const;
export const FRAME_CLOCK_EVENT_RETRY = 8 as const;
export const FRAME_CLOCK_EVENT_SCHEDULE_FAILED = 9 as const;
export const FRAME_CLOCK_EVENT_SCHEDULED_FRAME = 10 as const;
export const FRAME_CLOCK_EVENT_FLUSH_EXTERNAL = 11 as const;
export const FRAME_CLOCK_EVENT_INVALIDATE_AND_FLUSH_INTERNAL = 12 as const;

const FRAME_CLOCK_FAILED_TOKEN = -1;

export type FrameClockEffect =
  | typeof FRAME_CLOCK_EFFECT_NONE
  | typeof FRAME_CLOCK_EFFECT_RENDER
  | typeof FRAME_CLOCK_EFFECT_SCHEDULE;

export type FrameClockState = {
  available: boolean;
  demand: boolean;
  disposed: boolean;
  externalToken: number;
  nextToken: number;
  /** Positive while scheduled, zero while idle, negative after a render failure. */
  scheduledToken: number;
};

export type FrameClockEvent =
  | Readonly<{ kind: typeof FRAME_CLOCK_EVENT_ACQUIRE_EXTERNAL }>
  | Readonly<{ kind: typeof FRAME_CLOCK_EVENT_CONTEXT_BLOCKED }>
  | Readonly<{ kind: typeof FRAME_CLOCK_EVENT_CONTEXT_RESUMED }>
  | Readonly<{ kind: typeof FRAME_CLOCK_EVENT_DISPOSE }>
  | Readonly<{ kind: typeof FRAME_CLOCK_EVENT_FLUSH_INTERNAL }>
  | Readonly<{ kind: typeof FRAME_CLOCK_EVENT_INVALIDATE }>
  | Readonly<{ kind: typeof FRAME_CLOCK_EVENT_RELEASE_EXTERNAL; token: number }>
  | Readonly<{ kind: typeof FRAME_CLOCK_EVENT_RENDER_FAILED }>
  | Readonly<{ kind: typeof FRAME_CLOCK_EVENT_RETRY }>
  | Readonly<{ kind: typeof FRAME_CLOCK_EVENT_SCHEDULE_FAILED; token: number }>
  | Readonly<{ kind: typeof FRAME_CLOCK_EVENT_SCHEDULED_FRAME; token: number }>
  | Readonly<{ kind: typeof FRAME_CLOCK_EVENT_FLUSH_EXTERNAL; token: number }>
  | Readonly<{ kind: typeof FRAME_CLOCK_EVENT_INVALIDATE_AND_FLUSH_INTERNAL }>;

export type FrameClockTransition = {
  accepted: boolean;
  effect: FrameClockEffect;
  token: number;
};

export const createFrameClockState = (): FrameClockState => ({
  available: true,
  demand: false,
  disposed: false,
  externalToken: 0,
  nextToken: 1,
  scheduledToken: 0,
});

export const createFrameClockTransition = (): FrameClockTransition => ({
  accepted: false,
  effect: FRAME_CLOCK_EFFECT_NONE,
  token: 0,
});

const copyState = (source: FrameClockState, target: FrameClockState): void => {
  target.available = source.available;
  target.demand = source.demand;
  target.disposed = source.disposed;
  target.externalToken = source.externalToken;
  target.nextToken = source.nextToken;
  target.scheduledToken = source.scheduledToken;
};

const scheduleIfNeeded = (
  state: FrameClockState,
  transition: FrameClockTransition,
): void => {
  if (
    !state.available
    || !state.demand
    || state.disposed
    || state.externalToken !== 0
    || state.scheduledToken !== 0
  ) return;
  const token = state.nextToken;
  state.nextToken += 1;
  state.scheduledToken = token;
  transition.effect = FRAME_CLOCK_EFFECT_SCHEDULE;
  transition.token = token;
};

/** Plans one clock transition into caller-owned records without scheduling or rendering. */
export const planFrameClockTransition = (
  current: FrameClockState,
  event: FrameClockEvent,
  next: FrameClockState,
  transition: FrameClockTransition,
): void => {
  transition.accepted = false;
  transition.effect = FRAME_CLOCK_EFFECT_NONE;
  transition.token = 0;
  if (current.disposed) return;

  switch (event.kind) {
    case FRAME_CLOCK_EVENT_INVALIDATE:
      if (current.demand) {
        copyState(current, next);
        scheduleIfNeeded(next, transition);
        transition.accepted = next.scheduledToken !== current.scheduledToken;
        return;
      }
      copyState(current, next);
      next.demand = true;
      transition.accepted = true;
      scheduleIfNeeded(next, transition);
      return;
    case FRAME_CLOCK_EVENT_SCHEDULED_FRAME:
      if (event.token === 0 || event.token !== current.scheduledToken) return;
      copyState(current, next);
      next.scheduledToken = 0;
      transition.accepted = true;
      if (next.available && next.demand && next.externalToken === 0) {
        next.demand = false;
        transition.effect = FRAME_CLOCK_EFFECT_RENDER;
      }
      return;
    case FRAME_CLOCK_EVENT_SCHEDULE_FAILED:
      if (event.token === 0 || event.token !== current.scheduledToken) return;
      copyState(current, next);
      next.scheduledToken = 0;
      transition.accepted = true;
      return;
    case FRAME_CLOCK_EVENT_RENDER_FAILED:
      if (current.scheduledToken === FRAME_CLOCK_FAILED_TOKEN) return;
      copyState(current, next);
      next.demand = false;
      next.scheduledToken = FRAME_CLOCK_FAILED_TOKEN;
      transition.accepted = true;
      return;
    case FRAME_CLOCK_EVENT_RETRY:
      if (current.scheduledToken !== FRAME_CLOCK_FAILED_TOKEN) return;
      copyState(current, next);
      next.scheduledToken = 0;
      transition.accepted = true;
      scheduleIfNeeded(next, transition);
      return;
    case FRAME_CLOCK_EVENT_FLUSH_INTERNAL:
      if (
        !current.available
        || !current.demand
        || current.externalToken !== 0
        || current.scheduledToken === FRAME_CLOCK_FAILED_TOKEN
      ) return;
      copyState(current, next);
      next.demand = false;
      next.scheduledToken = 0;
      transition.accepted = true;
      transition.effect = FRAME_CLOCK_EFFECT_RENDER;
      return;
    case FRAME_CLOCK_EVENT_INVALIDATE_AND_FLUSH_INTERNAL:
      copyState(current, next);
      next.demand = true;
      transition.accepted = true;
      if (
        next.available
        && next.externalToken === 0
        && next.scheduledToken !== FRAME_CLOCK_FAILED_TOKEN
      ) {
        next.demand = false;
        next.scheduledToken = 0;
        transition.effect = FRAME_CLOCK_EFFECT_RENDER;
      }
      return;
    case FRAME_CLOCK_EVENT_ACQUIRE_EXTERNAL: {
      if (current.externalToken !== 0) return;
      copyState(current, next);
      const token = next.nextToken;
      next.nextToken += 1;
      next.externalToken = token;
      next.scheduledToken = 0;
      transition.accepted = true;
      transition.token = token;
      return;
    }
    case FRAME_CLOCK_EVENT_FLUSH_EXTERNAL:
      if (
        event.token === 0
        || event.token !== current.externalToken
        || !current.available
        || !current.demand
      ) return;
      copyState(current, next);
      next.demand = false;
      transition.accepted = true;
      transition.effect = FRAME_CLOCK_EFFECT_RENDER;
      return;
    case FRAME_CLOCK_EVENT_RELEASE_EXTERNAL:
      if (event.token === 0 || event.token !== current.externalToken) return;
      copyState(current, next);
      next.externalToken = 0;
      transition.accepted = true;
      scheduleIfNeeded(next, transition);
      return;
    case FRAME_CLOCK_EVENT_CONTEXT_BLOCKED:
      if (!current.available) return;
      copyState(current, next);
      next.available = false;
      next.scheduledToken = 0;
      transition.accepted = true;
      return;
    case FRAME_CLOCK_EVENT_CONTEXT_RESUMED:
      if (current.available) return;
      copyState(current, next);
      next.available = true;
      transition.accepted = true;
      scheduleIfNeeded(next, transition);
      return;
    case FRAME_CLOCK_EVENT_DISPOSE:
      copyState(current, next);
      next.available = false;
      next.demand = false;
      next.disposed = true;
      next.externalToken = 0;
      next.scheduledToken = 0;
      transition.accepted = true;
  }
};
