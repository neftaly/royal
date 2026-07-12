import { describe, expect, it } from "vitest";
import {
  beginVirtualTextureRequestFrame,
  createVirtualTextureRequestPlanningWorkspace,
  createVirtualTextureRequestScheduler,
  planVirtualTexturePageRequests,
  planVirtualTexturePageRequestsInto,
  resetVirtualTextureRequestScheduler,
  virtualTextureRequestBudgetAvailable,
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
  it("matches the allocating planner when using a reusable workspace", () => {
    const resources = [
      resource("a", 3),
      resource("blocked", 2, { loadingPages: 4 }),
      resource("b", 3, {
        pages: [
          { claimed: true, page: { mip: 0, x: 0, y: 0 }, resident: false, retryBlocked: false },
          { claimed: false, page: { mip: 0, x: 1, y: 0 }, resident: false, retryBlocked: false },
          { claimed: false, page: { mip: 0, x: 2, y: 0 }, resident: false, retryBlocked: false },
        ],
      }),
    ];
    const scheduler = createVirtualTextureRequestScheduler();
    const expected = planVirtualTexturePageRequests(scheduler, 7, resources, options);
    const actual = planVirtualTexturePageRequestsInto(
      createVirtualTextureRequestPlanningWorkspace(),
      scheduler,
      7,
      resources,
      options,
    );

    expect(actual).toEqual(expected);
  });

  it("reuses grant objects across equally sized plans", () => {
    const workspace = createVirtualTextureRequestPlanningWorkspace();
    const resources = [resource("a", 3), resource("b", 3)];
    const first = planVirtualTexturePageRequestsInto(
      workspace,
      createVirtualTextureRequestScheduler(),
      0,
      resources,
      { maxGrantsPerFrame: 2, maxInFlightPerResource: 4 },
    );
    const firstPlan = first;
    const firstGrant = first.grants[0];
    const secondGrant = first.grants[1];
    const second = planVirtualTexturePageRequestsInto(
      workspace,
      first.scheduler,
      1,
      resources,
      { maxGrantsPerFrame: 2, maxInFlightPerResource: 4 },
    );

    expect(second).toBe(firstPlan);
    expect(second.grants[0]).toBe(firstGrant);
    expect(second.grants[1]).toBe(secondGrant);
  });

  it("truncates reused grant storage after smaller and empty plans", () => {
    const workspace = createVirtualTextureRequestPlanningWorkspace();
    const resources = [resource("a", 4), resource("b", 4), resource("c", 4)];
    const first = planVirtualTexturePageRequestsInto(
      workspace,
      createVirtualTextureRequestScheduler(),
      0,
      resources,
      { maxGrantsPerFrame: 3, maxInFlightPerResource: 4 },
    );
    expect(first.grants).toHaveLength(3);

    const smaller = planVirtualTexturePageRequestsInto(
      workspace,
      first.scheduler,
      1,
      resources,
      { maxGrantsPerFrame: 1, maxInFlightPerResource: 4 },
    );
    expect(smaller.grants).toHaveLength(1);
    expect(smaller.grants.map((grant) => grant.key)).toEqual(["a"]);

    const empty = planVirtualTexturePageRequestsInto(
      workspace,
      smaller.scheduler,
      2,
      resources.map((entry) => ({ ...entry, enabled: false })),
      options,
    );
    expect(empty.grants).toEqual([]);
    expect(workspace.grants).toHaveLength(0);
  });

  it("keeps keyed fairness when a reusable workspace sees reordered resources", () => {
    const workspace = createVirtualTextureRequestPlanningWorkspace();
    const initialOrder = [resource("a", 2), resource("b", 2), resource("c", 2)];
    const first = planVirtualTexturePageRequestsInto(
      workspace,
      createVirtualTextureRequestScheduler(),
      0,
      initialOrder,
      { maxGrantsPerFrame: 2, maxInFlightPerResource: 4 },
    );
    expect(first.grants.map((grant) => grant.key)).toEqual(["a", "b"]);
    expect(first.scheduler.nextResourceKey).toBe("c");

    const reordered = [initialOrder[1]!, initialOrder[2]!, initialOrder[0]!];
    const second = planVirtualTexturePageRequestsInto(
      workspace,
      first.scheduler,
      1,
      reordered,
      { maxGrantsPerFrame: 1, maxInFlightPerResource: 4 },
    );
    expect(second.grants.map((grant) => grant.key)).toEqual(["c"]);
    expect(second.scheduler.nextResourceKey).toBe("a");
  });

  it("reports exhausted same-frame request budgets before snapshot materialization", () => {
    expect(virtualTextureRequestBudgetAvailable({
      cursor: 0,
      frame: 4,
      grantsThisFrame: 4,
    }, 4, 4)).toBe(false);
    expect(virtualTextureRequestBudgetAvailable({
      cursor: 0,
      frame: 4,
      grantsThisFrame: 4,
    }, 5, 4)).toBe(true);
  });
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

});
