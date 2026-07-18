import { describe, expect, it, vi } from "vitest";
import {
  createFrameClockState,
  createFrameClockTransition,
  FRAME_CLOCK_EFFECT_RENDER,
  FRAME_CLOCK_EFFECT_SCHEDULE,
  planFrameClockTransition,
  type FrameClockEvent,
  type FrameClockState,
} from "../packages/renderer-webgl/src/frame/frame-clock";
import { FrameClockOwner } from "../packages/renderer-webgl/src/frame/frame-clock-owner";

const transition = (
  current: FrameClockState,
  event: FrameClockEvent,
): { readonly accepted: boolean; readonly effect: number; readonly next: FrameClockState; readonly token: number } => {
  const next = createFrameClockState();
  const result = createFrameClockTransition();
  planFrameClockTransition(current, event, next, result);
  return { ...result, next };
};

describe("frame clock core", () => {
  it("coalesces demand into one scheduled token", () => {
    const first = transition(createFrameClockState(), { kind: "invalidate" });
    expect(first).toMatchObject({ accepted: true, effect: FRAME_CLOCK_EFFECT_SCHEDULE, token: 1 });
    expect(first.next).toMatchObject({ demand: true, nextToken: 2, scheduledToken: 1 });
    expect(transition(first.next, { kind: "invalidate" }).accepted).toBe(false);
  });

  it("ignores stale callbacks and consumes current demand exactly once", () => {
    const scheduled = transition(createFrameClockState(), { kind: "invalidate" }).next;
    expect(transition(scheduled, { kind: "scheduled-frame", token: 99 }).accepted).toBe(false);
    const render = transition(scheduled, { kind: "scheduled-frame", token: 1 });
    expect(render).toMatchObject({ accepted: true, effect: FRAME_CLOCK_EFFECT_RENDER });
    expect(render.next).toMatchObject({ demand: false, scheduledToken: 0 });
  });

  it("retains demand across context interruption", () => {
    const scheduled = transition(createFrameClockState(), { kind: "invalidate" }).next;
    const blocked = transition(scheduled, { kind: "context-blocked" }).next;
    expect(blocked).toMatchObject({ available: false, demand: true, scheduledToken: 0 });
    const resumed = transition(blocked, { kind: "context-resumed" });
    expect(resumed).toMatchObject({ accepted: true, effect: FRAME_CLOCK_EFFECT_SCHEDULE });
    expect(resumed.next).toMatchObject({ available: true, demand: true, scheduledToken: 2 });
  });

  it("gives one external clock exclusive scheduling authority", () => {
    const scheduled = transition(createFrameClockState(), { kind: "invalidate" }).next;
    const acquired = transition(scheduled, { kind: "acquire-external" });
    expect(acquired.next).toMatchObject({ demand: true, externalToken: 2, scheduledToken: 0 });
    expect(transition(acquired.next, { kind: "acquire-external" }).accepted).toBe(false);
    const flushed = transition(acquired.next, { kind: "flush-external", token: 2 });
    expect(flushed).toMatchObject({ accepted: true, effect: FRAME_CLOCK_EFFECT_RENDER });
    const released = transition(flushed.next, { kind: "release-external", token: 2 });
    expect(released.next.externalToken).toBe(0);
  });
});

describe("frame clock shell", () => {
  it("schedules once, renders once and ignores the stale callback after an explicit flush", () => {
    const callbacks: Array<() => void> = [];
    const render = vi.fn();
    const owner = new FrameClockOwner({
      render,
      reportScheduledFailure: vi.fn(),
      requestFrame: (callback) => callbacks.push(callback),
    });
    owner.invalidate();
    owner.invalidate();
    expect(callbacks).toHaveLength(1);
    owner.flushInvalidated();
    expect(render).toHaveBeenCalledTimes(1);
    callbacks[0]!();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("keeps pending work for an external clock and resumes browser scheduling on release", () => {
    const callbacks: Array<() => void> = [];
    const render = vi.fn();
    const owner = new FrameClockOwner({
      render,
      reportScheduledFailure: vi.fn(),
      requestFrame: (callback) => callbacks.push(callback),
    });
    const external = owner.acquireExternalClock();
    owner.invalidate();
    expect(callbacks).toHaveLength(0);
    external.flushInvalidated();
    expect(render).toHaveBeenCalledTimes(1);
    owner.invalidate();
    external.release();
    expect(callbacks).toHaveLength(1);
    callbacks[0]!();
    expect(render).toHaveBeenCalledTimes(2);
  });
});
