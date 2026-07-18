export const FRAME_CLOCK_EFFECT_NONE = 0 as const;
export const FRAME_CLOCK_EFFECT_RENDER = 1 as const;
export const FRAME_CLOCK_EFFECT_SCHEDULE = 2 as const;

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
  scheduledToken: number;
};

export type FrameClockEvent =
  | Readonly<{ kind: "acquire-external" }>
  | Readonly<{ kind: "context-blocked" }>
  | Readonly<{ kind: "context-resumed" }>
  | Readonly<{ kind: "dispose" }>
  | Readonly<{ kind: "flush-internal" }>
  | Readonly<{ kind: "invalidate" }>
  | Readonly<{ kind: "release-external"; token: number }>
  | Readonly<{ kind: "schedule-failed"; token: number }>
  | Readonly<{ kind: "scheduled-frame"; token: number }>
  | Readonly<{ kind: "flush-external"; token: number }>;

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
    case "invalidate":
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
    case "scheduled-frame":
      if (event.token === 0 || event.token !== current.scheduledToken) return;
      copyState(current, next);
      next.scheduledToken = 0;
      transition.accepted = true;
      if (next.available && next.demand && next.externalToken === 0) {
        next.demand = false;
        transition.effect = FRAME_CLOCK_EFFECT_RENDER;
      }
      return;
    case "schedule-failed":
      if (event.token === 0 || event.token !== current.scheduledToken) return;
      copyState(current, next);
      next.scheduledToken = 0;
      transition.accepted = true;
      return;
    case "flush-internal":
      if (!current.available || !current.demand || current.externalToken !== 0) return;
      copyState(current, next);
      next.demand = false;
      next.scheduledToken = 0;
      transition.accepted = true;
      transition.effect = FRAME_CLOCK_EFFECT_RENDER;
      return;
    case "acquire-external": {
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
    case "flush-external":
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
    case "release-external":
      if (event.token === 0 || event.token !== current.externalToken) return;
      copyState(current, next);
      next.externalToken = 0;
      transition.accepted = true;
      scheduleIfNeeded(next, transition);
      return;
    case "context-blocked":
      if (!current.available) return;
      copyState(current, next);
      next.available = false;
      next.scheduledToken = 0;
      transition.accepted = true;
      return;
    case "context-resumed":
      if (current.available) return;
      copyState(current, next);
      next.available = true;
      transition.accepted = true;
      scheduleIfNeeded(next, transition);
      return;
    case "dispose":
      copyState(current, next);
      next.available = false;
      next.demand = false;
      next.disposed = true;
      next.externalToken = 0;
      next.scheduledToken = 0;
      transition.accepted = true;
  }
};
