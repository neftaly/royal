import { describe, expect, it, vi } from "vitest";
import {
  createFrameClockState,
  createFrameClockTransition,
  FRAME_CLOCK_EVENT_ACQUIRE_EXTERNAL,
  FRAME_CLOCK_EVENT_CONTEXT_BLOCKED,
  FRAME_CLOCK_EVENT_CONTEXT_RESUMED,
  FRAME_CLOCK_EVENT_FLUSH_EXTERNAL,
  FRAME_CLOCK_EVENT_INVALIDATE,
  FRAME_CLOCK_EVENT_RELEASE_EXTERNAL,
  FRAME_CLOCK_EVENT_RENDER_FAILED,
  FRAME_CLOCK_EVENT_RETRY,
  FRAME_CLOCK_EVENT_SCHEDULED_FRAME,
  FRAME_CLOCK_EFFECT_RENDER,
  FRAME_CLOCK_EFFECT_SCHEDULE,
  planFrameClockTransition,
  type FrameClockEvent,
  type FrameClockState,
} from "../../packages/renderer-webgl/src/frame/frame-clock";
import { FrameClockOwner } from "../../packages/renderer-webgl/src/frame/frame-clock-owner";

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
    const first = transition(createFrameClockState(), { kind: FRAME_CLOCK_EVENT_INVALIDATE });
    expect(first).toMatchObject({ accepted: true, effect: FRAME_CLOCK_EFFECT_SCHEDULE, token: 1 });
    expect(first.next).toMatchObject({ demand: true, nextToken: 2, scheduledToken: 1 });
    expect(transition(first.next, { kind: FRAME_CLOCK_EVENT_INVALIDATE }).accepted).toBe(false);
  });

  it("ignores stale callbacks and consumes current demand exactly once", () => {
    const scheduled = transition(createFrameClockState(), { kind: FRAME_CLOCK_EVENT_INVALIDATE }).next;
    expect(transition(scheduled, {
      kind: FRAME_CLOCK_EVENT_SCHEDULED_FRAME,
      token: 99,
    }).accepted).toBe(false);
    const render = transition(scheduled, { kind: FRAME_CLOCK_EVENT_SCHEDULED_FRAME, token: 1 });
    expect(render).toMatchObject({ accepted: true, effect: FRAME_CLOCK_EFFECT_RENDER });
    expect(render.next).toMatchObject({ demand: false, scheduledToken: 0 });
  });

  it("retains demand across context interruption", () => {
    const scheduled = transition(createFrameClockState(), { kind: FRAME_CLOCK_EVENT_INVALIDATE }).next;
    const blocked = transition(scheduled, { kind: FRAME_CLOCK_EVENT_CONTEXT_BLOCKED }).next;
    expect(blocked).toMatchObject({ available: false, demand: true, scheduledToken: 0 });
    const resumed = transition(blocked, { kind: FRAME_CLOCK_EVENT_CONTEXT_RESUMED });
    expect(resumed).toMatchObject({ accepted: true, effect: FRAME_CLOCK_EFFECT_SCHEDULE });
    expect(resumed.next).toMatchObject({ available: true, demand: true, scheduledToken: 2 });
  });

  it("latches a render failure until an explicit retry", () => {
    const scheduled = transition(createFrameClockState(), { kind: FRAME_CLOCK_EVENT_INVALIDATE }).next;
    const rendering = transition(scheduled, {
      kind: FRAME_CLOCK_EVENT_SCHEDULED_FRAME,
      token: 1,
    }).next;
    const queuedDuringRender = transition(rendering, { kind: FRAME_CLOCK_EVENT_INVALIDATE }).next;
    const failed = transition(queuedDuringRender, { kind: FRAME_CLOCK_EVENT_RENDER_FAILED });
    expect(failed.next).toMatchObject({ demand: false, scheduledToken: -1 });
    const pending = transition(failed.next, { kind: FRAME_CLOCK_EVENT_INVALIDATE });
    expect(pending).toMatchObject({ accepted: true, effect: 0 });
    expect(pending.next).toMatchObject({ demand: true, scheduledToken: -1 });
    const retry = transition(pending.next, { kind: FRAME_CLOCK_EVENT_RETRY });
    expect(retry).toMatchObject({ accepted: true, effect: FRAME_CLOCK_EFFECT_SCHEDULE });
    expect(retry.next).toMatchObject({ scheduledToken: 3 });
  });

  it("gives one external clock exclusive scheduling authority", () => {
    const scheduled = transition(createFrameClockState(), { kind: FRAME_CLOCK_EVENT_INVALIDATE }).next;
    const acquired = transition(scheduled, { kind: FRAME_CLOCK_EVENT_ACQUIRE_EXTERNAL });
    expect(acquired.next).toMatchObject({ demand: true, externalToken: 2, scheduledToken: 0 });
    expect(transition(acquired.next, {
      kind: FRAME_CLOCK_EVENT_ACQUIRE_EXTERNAL,
    }).accepted).toBe(false);
    const flushed = transition(acquired.next, { kind: FRAME_CLOCK_EVENT_FLUSH_EXTERNAL, token: 2 });
    expect(flushed).toMatchObject({ accepted: true, effect: FRAME_CLOCK_EFFECT_RENDER });
    const released = transition(flushed.next, {
      kind: FRAME_CLOCK_EVENT_RELEASE_EXTERNAL,
      token: 2,
    });
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

  it("retains demand and permits retry when the host scheduler throws synchronously", () => {
    const callbacks: Array<() => void> = [];
    const failure = new Error("scheduler unavailable");
    const reportScheduledFailure = vi.fn();
    let attempts = 0;
    const owner = new FrameClockOwner({
      render: vi.fn(),
      reportScheduledFailure,
      requestFrame: (callback) => {
        attempts += 1;
        if (attempts === 1) throw failure;
        callbacks.push(callback);
      },
    });
    expect(() => owner.invalidate()).not.toThrow();
    expect(reportScheduledFailure).toHaveBeenCalledWith(failure);
    owner.invalidate();
    expect(callbacks).toHaveLength(1);
  });

  it("reports one scheduled render failure and ignores already queued retry work", () => {
    const callbacks: Array<() => void> = [];
    const failure = new Error("shader compilation failed");
    const reportScheduledFailure = vi.fn();
    let attempts = 0;
    const owner = new FrameClockOwner({
      render: () => {
        attempts += 1;
        owner.invalidate();
        throw failure;
      },
      reportScheduledFailure,
      requestFrame: (callback) => callbacks.push(callback),
    });
    owner.invalidate();
    callbacks.shift()!();
    expect(attempts).toBe(1);
    expect(reportScheduledFailure).toHaveBeenCalledTimes(1);
    expect(callbacks).toHaveLength(1);
    callbacks.shift()!();
    owner.invalidate();
    expect(callbacks).toHaveLength(0);
    owner.retry();
    expect(callbacks).toHaveLength(1);
  });
});
