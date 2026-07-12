import { describe, expect, it } from "vitest";
import {
  beginVirtualTextureRequestFrame,
  createVirtualTexturePageRetryState,
  createVirtualTextureRequestScheduler,
  elapseVirtualTexturePageRetry,
  failVirtualTexturePageRetry,
  planVirtualTexturePageRequests,
  resetVirtualTexturePageRetry,
  resetVirtualTextureRequestScheduler,
  terminateVirtualTexturePageRetry,
  type VirtualTextureRequestResourceSnapshot,
} from "../packages/renderer-webgl/src/virtual-texture-orchestration";

const resource = (
  key: string,
  pageCount = 1,
  overrides: Partial<VirtualTextureRequestResourceSnapshot> = {},
): VirtualTextureRequestResourceSnapshot => ({
  allocated: true,
  effectiveSlots: 4,
  enabled: true,
  key,
  loadingPages: 0,
  pages: Array.from({ length: pageCount }, (_value, x) => ({
    claimed: false,
    page: { mip: 0, x, y: 0 },
    resident: false,
    retryBlocked: false,
  })),
  pendingUploads: 0,
  ...overrides,
});

const options = { maxGrantsPerFrame: 4, maxInFlightPerResource: 4 } as const;

describe("virtual texture pure request orchestration", () => {
  it("rotates round-robin grants across a fixed resource order and across frames", () => {
    const resources = Array.from({ length: 5 }, (_value, index) => resource(String(index), 5));
    const first = planVirtualTexturePageRequests(createVirtualTextureRequestScheduler(), 10, resources, options);
    expect(first.grants.map((grant) => grant.key)).toEqual(["0", "1", "2", "3"]);
    expect(first.scheduler).toEqual({ cursor: 4, frame: 10, grantsThisFrame: 4, nextResourceKey: "4" });

    const second = planVirtualTexturePageRequests(first.scheduler, 11, resources, options);
    expect(second.grants.map((grant) => grant.key)).toEqual(["4", "0", "1", "2"]);
    expect(second.scheduler).toEqual({ cursor: 3, frame: 11, grantsThisFrame: 4, nextResourceKey: "3" });
  });

  it("anchors the next grant to resource identity when snapshot order changes", () => {
    const initialOrder = [resource("a", 2), resource("b", 2), resource("c", 2)];
    const first = planVirtualTexturePageRequests(
      createVirtualTextureRequestScheduler(),
      0,
      initialOrder,
      { maxGrantsPerFrame: 2, maxInFlightPerResource: 4 },
    );
    expect(first.grants.map((grant) => grant.key)).toEqual(["a", "b"]);
    expect(first.scheduler.nextResourceKey).toBe("c");

    const reordered = [initialOrder[2]!, initialOrder[0]!, initialOrder[1]!];
    const second = planVirtualTexturePageRequests(
      first.scheduler,
      1,
      reordered,
      { maxGrantsPerFrame: 1, maxInFlightPerResource: 4 },
    );
    expect(second.grants.map((grant) => grant.key)).toEqual(["c"]);
    expect(second.scheduler.nextResourceKey).toBe("a");
  });

  it("preserves the identity cursor through frames with no enabled resources", () => {
    const initialOrder = [resource("a"), resource("b"), resource("c")];
    const first = planVirtualTexturePageRequests(
      createVirtualTextureRequestScheduler(),
      0,
      initialOrder,
      { maxGrantsPerFrame: 2, maxInFlightPerResource: 4 },
    );
    expect(first.scheduler.nextResourceKey).toBe("c");

    const idle = planVirtualTexturePageRequests(
      first.scheduler,
      1,
      initialOrder.map((entry) => ({ ...entry, enabled: false })),
      options,
    );
    expect(idle.grants).toEqual([]);
    expect(idle.scheduler).toMatchObject({ frame: 1, grantsThisFrame: 0, nextResourceKey: "c" });

    const reordered = [initialOrder[1]!, initialOrder[2]!, initialOrder[0]!];
    const resumed = planVirtualTexturePageRequests(
      idle.scheduler,
      2,
      reordered,
      { maxGrantsPerFrame: 1, maxInFlightPerResource: 4 },
    );
    expect(resumed.grants.map((grant) => grant.key)).toEqual(["c"]);
  });

  it("keeps grants monotonic within a frame and resets only the grant count on a new frame", () => {
    const first = planVirtualTexturePageRequests(
      createVirtualTextureRequestScheduler(),
      3,
      [resource("a", 8)],
      { maxGrantsPerFrame: 2, maxInFlightPerResource: 8 },
    );
    expect(first.grants).toHaveLength(2);
    const capped = planVirtualTexturePageRequests(
      first.scheduler,
      3,
      [resource("a", 8)],
      { maxGrantsPerFrame: 2, maxInFlightPerResource: 8 },
    );
    expect(capped.grants).toEqual([]);
    expect(capped.scheduler).toBe(first.scheduler);

    expect(beginVirtualTextureRequestFrame(first.scheduler, 4)).toEqual({
      cursor: first.scheduler.cursor,
      frame: 4,
      grantsThisFrame: 0,
      nextResourceKey: first.scheduler.nextResourceKey,
    });
    expect(() => beginVirtualTextureRequestFrame(first.scheduler, 2)).toThrow(/monotonic/);
  });

  it("simulates in-flight increments so multiple grants cannot exceed a resource limit", () => {
    const plan = planVirtualTexturePageRequests(
      createVirtualTextureRequestScheduler(),
      0,
      [resource("a", 8, { effectiveSlots: 3, loadingPages: 1, pendingUploads: 1 })],
      { maxGrantsPerFrame: 8, maxInFlightPerResource: 4 },
    );
    expect(plan.grants).toEqual([{ key: "a", page: { mip: 0, x: 0, y: 0 } }]);
    expect(plan.scheduler.grantsThisFrame).toBe(1);

    const slotBound = planVirtualTexturePageRequests(
      createVirtualTextureRequestScheduler(),
      0,
      [resource("b", 8, { effectiveSlots: 2 })],
      { maxGrantsPerFrame: 8, maxInFlightPerResource: 4 },
    );
    expect(slotBound.grants).toHaveLength(2);
  });

  it("skips claimed, resident, retry-blocked, disabled, dormant, and full resources without spinning", () => {
    const blockedPages = resource("pages", 3, {
      pages: [
        { claimed: true, page: { mip: 0, x: 0, y: 0 }, resident: false, retryBlocked: false },
        { claimed: false, page: { mip: 0, x: 1, y: 0 }, resident: true, retryBlocked: false },
        { claimed: false, page: { mip: 0, x: 2, y: 0 }, resident: false, retryBlocked: true },
      ],
    });
    const resources = [
      blockedPages,
      resource("disabled", 1, { enabled: false }),
      resource("dormant", 1, { allocated: false }),
      resource("full", 1, { effectiveSlots: 1, loadingPages: 1 }),
    ];
    const plan = planVirtualTexturePageRequests(createVirtualTextureRequestScheduler(), 5, resources, options);
    expect(plan.grants).toEqual([]);
    expect(plan.scheduler).toEqual({ cursor: 0, frame: 5, grantsThisFrame: 0, nextResourceKey: "pages" });
  });

  it("resets cursor, frame, and grant accounting for context loss", () => {
    const active = { cursor: 7, frame: 20, grantsThisFrame: 3 };
    expect(resetVirtualTextureRequestScheduler()).toEqual({ cursor: 0, frame: -1, grantsThisFrame: 0 });
    expect(resetVirtualTextureRequestScheduler()).not.toBe(active);
  });

  it("represents eligible, scheduled, elapsed, and terminal retry states without timer handles", () => {
    const retryOptions = { baseDelayMs: 50, maxRetries: 2 };
    const initial = createVirtualTexturePageRetryState();
    expect(initial).toEqual({ attempts: 0, kind: "eligible" });
    const first = failVirtualTexturePageRetry(initial, retryOptions);
    expect(first).toEqual({ attempts: 1, delayMs: 50, kind: "scheduled" });
    const firstElapsed = elapseVirtualTexturePageRetry(first);
    expect(firstElapsed).toEqual({ attempts: 1, kind: "eligible" });
    const second = failVirtualTexturePageRetry(firstElapsed, retryOptions);
    expect(second).toEqual({ attempts: 2, delayMs: 100, kind: "scheduled" });
    const terminal = failVirtualTexturePageRetry(elapseVirtualTexturePageRetry(second), retryOptions);
    expect(terminal).toEqual({ attempts: 2, kind: "terminal" });
    expect(failVirtualTexturePageRetry(terminal, retryOptions)).toBe(terminal);
    expect(terminateVirtualTexturePageRetry(firstElapsed)).toEqual({ attempts: 1, kind: "terminal" });
    expect(resetVirtualTexturePageRetry()).toEqual(initial);
  });
});
