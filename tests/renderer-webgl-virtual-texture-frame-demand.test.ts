import { describe, expect, it } from "vitest";
import {
  advanceVirtualTextureFrameDemand,
  beginVirtualTextureFrameDemand,
  createVirtualTextureFrameDemandWorkspace,
  finalizeVirtualTextureFrameDemand,
  releaseVirtualTextureFrameDemandResource,
  resetVirtualTextureFrameDemand,
  submitVirtualTextureFrameDemand as submitBoundedVirtualTextureFrameDemand,
  VIRTUAL_TEXTURE_FRAME_DEMAND_MAX_RESOURCE_PAGES,
  VIRTUAL_TEXTURE_FRAME_DEMAND_MAX_RESOURCES,
  VIRTUAL_TEXTURE_FRAME_DEMAND_MAX_RESOURCE_VIEWS,
} from "../packages/renderer-webgl/src/virtual-texture/frame-demand";
import {
  selectVirtualTextureFrameWorkingSet,
  type VirtualTextureDemandSubmission,
} from "../packages/renderer-webgl/src/virtual-texture/demand";
import {
  virtualTexturePageKey,
  type VirtualTexturePageId,
} from "../packages/renderer-webgl/src/virtual-texture/model";
import { forEachFuzzCase } from "./fuzz";

const page = (x: number, mip = 0): VirtualTexturePageId => ({ mip, x, y: 0 });

const submission = (
  candidates: readonly VirtualTexturePageId[],
  preferTargetMip = true,
): VirtualTextureDemandSubmission => ({ candidates, preferTargetMip });

const committedSubmission = (
  candidates: readonly VirtualTexturePageId[],
  preferredCandidates: readonly VirtualTexturePageId[] = candidates,
): VirtualTextureDemandSubmission => ({ candidates, preferTargetMip: true, preferredCandidates });

const resourceOrders = new Map<unknown, number>();
const resourceOrder = (resource: unknown): number => {
  let order = resourceOrders.get(resource);
  if (order === undefined) {
    order = resourceOrders.size;
    resourceOrders.set(resource, order);
  }
  return order;
};

const submitVirtualTextureFrameDemand = <K>(
  workspace: ReturnType<typeof createVirtualTextureFrameDemandWorkspace<K>>,
  resource: K,
  viewIndex: number,
  demand: VirtualTextureDemandSubmission,
  capacity = 4,
): void => submitBoundedVirtualTextureFrameDemand(
  workspace,
  resource,
  resourceOrder(resource),
  viewIndex,
  capacity,
  demand,
);

describe("virtual texture frame-demand workspace", () => {
  it("reuses borrowed publication storage across frames", () => {
    const workspace = createVirtualTextureFrameDemandWorkspace<string>();
    beginVirtualTextureFrameDemand(workspace);
    submitVirtualTextureFrameDemand(workspace, "surface", 0, submission([page(0), page(1)]));
    const firstCommits = finalizeVirtualTextureFrameDemand(workspace, true, () => 0);
    const firstCommit = firstCommits[0]!;
    const firstSubmissions = firstCommit.submissions;
    const firstSubmission = firstSubmissions[0]!;
    const firstCandidates = firstSubmission.candidates;
    const firstPreferred = firstSubmission.preferredCandidates;
    advanceVirtualTextureFrameDemand(workspace, firstCommit);

    beginVirtualTextureFrameDemand(workspace);
    submitVirtualTextureFrameDemand(workspace, "surface", 0, submission([page(2), page(3)]));
    const secondCommits = finalizeVirtualTextureFrameDemand(workspace, true, () => 0);
    const secondCommit = secondCommits[0]!;
    const secondSubmission = secondCommit.submissions[0]!;

    expect(secondCommits).toBe(firstCommits);
    expect(secondCommit).toBe(firstCommit);
    expect(secondCommit.submissions).toBe(firstSubmissions);
    expect(secondSubmission).toBe(firstSubmission);
    expect(secondSubmission.candidates).toBe(firstCandidates);
    expect(secondSubmission.preferredCandidates).toBe(firstPreferred);
    expect(secondSubmission).toEqual(committedSubmission([page(2), page(3)]));
  });

  it("gives each view one fairness lane regardless of repeated object draws", () => {
    const workspace = createVirtualTextureFrameDemandWorkspace<string>();
    beginVirtualTextureFrameDemand(workspace);

    for (let draw = 0; draw < 100; draw += 1) {
      submitVirtualTextureFrameDemand(workspace, "surface", 0, submission([page(draw % 2)]));
    }
    submitVirtualTextureFrameDemand(workspace, "surface", 1, submission([page(10)]));

    const commits = finalizeVirtualTextureFrameDemand(workspace, true, () => 0);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      nextStartSubmission: 1,
      resource: "surface",
      startSubmission: 0,
    });
    expect(commits[0]!.submissions).toEqual([
      committedSubmission([page(0), page(1)]),
      committedSubmission([page(10)]),
    ]);
  });

  it("merges same-view candidates stably by page identity and ORs target preference", () => {
    const workspace = createVirtualTextureFrameDemandWorkspace<string>();
    beginVirtualTextureFrameDemand(workspace);
    submitVirtualTextureFrameDemand(workspace, "surface", 3, submission([page(4), page(5)], false));
    submitVirtualTextureFrameDemand(workspace, "surface", 3, submission([page(5), page(6)], true));
    submitVirtualTextureFrameDemand(workspace, "surface", 3, submission([page(4)], false));

    const [commit] = finalizeVirtualTextureFrameDemand(workspace, true, () => 9);
    expect(commit!.submissions).toEqual([
      committedSubmission([page(4), page(5), page(6)], [page(5), page(6)]),
    ]);
    expect(commit).toMatchObject({ nextStartSubmission: 0, startSubmission: 0 });
  });

  it("preserves preferred pages when repeated draws in one view target different mips", () => {
    const workspace = createVirtualTextureFrameDemandWorkspace<string>();
    const coarse = page(0, 3);
    const nearTarget = page(1, 0);
    const farTarget = page(2, 1);
    beginVirtualTextureFrameDemand(workspace);
    submitVirtualTextureFrameDemand(workspace, "surface", 0, submission([coarse, nearTarget]));
    submitVirtualTextureFrameDemand(workspace, "surface", 0, submission([coarse, farTarget]));

    const [commit] = finalizeVirtualTextureFrameDemand(workspace, true, () => 0);
    expect(commit!.submissions).toEqual([{
      candidates: [coarse, nearTarget, farTarget],
      preferTargetMip: true,
      preferredCandidates: [nearTarget, farTarget],
    }]);
    expect(selectVirtualTextureFrameWorkingSet(commit!.submissions, 3)).toEqual([
      coarse,
      nearTarget,
      farTarget,
    ]);
  });

  it("keeps the coarsest fallback without replacing an earlier draw's target preference", () => {
    const workspace = createVirtualTextureFrameDemandWorkspace<string>();
    const coarse = page(0, 3);
    const target = page(1, 0);
    const laterFallback = page(0, 4);
    beginVirtualTextureFrameDemand(workspace);
    submitVirtualTextureFrameDemand(workspace, "surface", 0, submission([coarse, target]));
    submitVirtualTextureFrameDemand(workspace, "surface", 0, submission([laterFallback], false));

    const [commit] = finalizeVirtualTextureFrameDemand(workspace, true, () => 0);
    expect(commit!.submissions).toEqual([{
      candidates: [coarse, target, laterFallback],
      preferTargetMip: true,
      preferredCandidates: [target],
    }]);
    expect(selectVirtualTextureFrameWorkingSet(commit!.submissions, 2)).toEqual([coarse, target]);
  });

  it("selects distinct draw groups stably without weighting duplicate draws", () => {
    const workspace = createVirtualTextureFrameDemandWorkspace<string>();
    const parent = page(0, 2);
    const left = page(0);
    const right = page(3);
    const selectFrame = (): readonly VirtualTexturePageId[] => {
      beginVirtualTextureFrameDemand(workspace);
      for (let draw = 0; draw < 100; draw += 1) {
        submitVirtualTextureFrameDemand(workspace, "surface", 0, submission([parent, left]), 2);
      }
      submitVirtualTextureFrameDemand(workspace, "surface", 0, submission([parent, right]), 2);
      const retained = workspace.resources.get("surface")!.views.get(0)!.preferred;
      expect(new Set([...retained.values()].map((item) => item.signature)).size).toBe(2);
      const [commit] = finalizeVirtualTextureFrameDemand(workspace, true, () => 0);
      const selected = selectVirtualTextureFrameWorkingSet(
        commit!.submissions,
        2,
        commit!.startSubmission,
      );
      advanceVirtualTextureFrameDemand(workspace, commit!);
      return selected;
    };

    expect(selectFrame()).toEqual([parent, left]);
    expect(selectFrame()).toEqual([parent, left]);
    expect(selectFrame()).toEqual([parent, left]);
  });

  it("keeps a bounded close-detail frontier stable across publications", () => {
    const workspace = createVirtualTextureFrameDemandWorkspace<string>();
    const coarse = page(0, 8);
    const preferred = [coarse, ...Array.from({ length: 63 }, (_value, index) => page(index + 1))];
    let firstWindow: readonly VirtualTexturePageId[] | undefined;

    for (let frame = 0; frame < 4; frame += 1) {
      beginVirtualTextureFrameDemand(workspace);
      submitBoundedVirtualTextureFrameDemand(
        workspace,
        "close-surface",
        resourceOrder("close-surface"),
        0,
        64,
        {
          candidates: preferred,
          preferTargetMip: true,
          preferredCandidates: preferred,
          viewportDominant: true,
        },
      );
      const [commit] = finalizeVirtualTextureFrameDemand(workspace, true, () => 0);
      const selected = selectVirtualTextureFrameWorkingSet(commit!.submissions, 64);
      if (firstWindow === undefined) firstWindow = [...selected];
      else expect(selected).toEqual(firstWindow);
      advanceVirtualTextureFrameDemand(workspace, commit!);
    }

    expect(firstWindow!.length).toBeGreaterThan(32);
    expect(firstWindow!.length).toBeLessThan(preferred.length);
  });

  it("keeps group preference stable after publication and accepts a retained prepared commit", () => {
    const workspace = createVirtualTextureFrameDemandWorkspace<string>();
    const parent = page(0, 2);
    const left = page(0);
    const right = page(3);
    const prepare = () => {
      beginVirtualTextureFrameDemand(workspace);
      submitVirtualTextureFrameDemand(workspace, "surface", 0, submission([parent, left]), 2);
      submitVirtualTextureFrameDemand(workspace, "surface", 0, submission([parent, right]), 2);
      return finalizeVirtualTextureFrameDemand(workspace, true, () => 0)[0]!;
    };
    const select = (commit: ReturnType<typeof prepare>) =>
      selectVirtualTextureFrameWorkingSet(commit.submissions, 2, commit.startSubmission);

    const retained = prepare();
    expect(select(retained)).toEqual([parent, left]);
    const unpublishedRetry = prepare();
    expect(select(unpublishedRetry)).toEqual([parent, left]);
    expect(select(retained)).toEqual([parent, left]);

    // The first prepared result remains a valid acknowledgment even after the
    // collection pools have been reused to prepare another frame.
    advanceVirtualTextureFrameDemand(workspace, retained);
    expect(select(prepare())).toEqual([parent, left]);
  });

  it("keeps group preference stable when collection aborts", () => {
    const workspace = createVirtualTextureFrameDemandWorkspace<string>();
    const parent = page(0, 2);
    const left = page(0);
    const right = page(3);
    const submitGroups = (): void => {
      beginVirtualTextureFrameDemand(workspace);
      submitVirtualTextureFrameDemand(workspace, "surface", 0, submission([parent, left]));
      submitVirtualTextureFrameDemand(workspace, "surface", 0, submission([parent, right]));
    };

    submitGroups();
    expect(finalizeVirtualTextureFrameDemand(workspace, false, () => 0)).toEqual([]);
    submitGroups();
    const [commit] = finalizeVirtualTextureFrameDemand(workspace, true, () => 0);
    expect(selectVirtualTextureFrameWorkingSet(commit!.submissions, 2)).toEqual([parent, left]);
  });

  it("keeps arbitrary resource/view collection isolated, ordered, and draw-count independent", () => {
    forEachFuzzCase({ cases: 48, seed: 0xf4a6_d3ad }, ({ label, random }) => {
      const workspace = createVirtualTextureFrameDemandWorkspace<string>();
      const resourceCount = random.int(1, 5);
      const cursors = new Map<string, number>();
      const draws: Array<{ page: VirtualTexturePageId; resource: string; view: number }> = [];
      for (let resourceIndex = 0; resourceIndex < resourceCount; resourceIndex += 1) {
        const resource = `resource-${resourceIndex}`;
        cursors.set(resource, random.int(0, 12));
        const viewCount = random.int(1, 7);
        const availableViews = Array.from({ length: 12 }, (_value, view) => view);
        for (let index = availableViews.length - 1; index > 0; index -= 1) {
          const other = random.int(0, index + 1);
          [availableViews[index], availableViews[other]] = [availableViews[other]!, availableViews[index]!];
        }
        for (const view of availableViews.slice(0, viewCount)) {
          draws.push({ page: page(resourceIndex * 16 + view), resource, view });
        }
      }
      for (let index = draws.length - 1; index > 0; index -= 1) {
        const other = random.int(0, index + 1);
        [draws[index], draws[other]] = [draws[other]!, draws[index]!];
      }

      const firstSeenResources: string[] = [];
      const seenResources = new Set<string>();
      beginVirtualTextureFrameDemand(workspace);
      for (const draw of draws) {
        if (!seenResources.has(draw.resource)) {
          seenResources.add(draw.resource);
          firstSeenResources.push(draw.resource);
        }
        const repetitions = random.int(1, 24);
        for (let repetition = 0; repetition < repetitions; repetition += 1) {
          submitVirtualTextureFrameDemand(
            workspace,
            draw.resource,
            draw.view,
            submission([draw.page]),
            16,
          );
        }
      }

      const commits = finalizeVirtualTextureFrameDemand(
        workspace,
        true,
        (resource) => cursors.get(resource)!,
      );
      expect(commits.map((commit) => commit.resource), `${label} stable resource order`)
        .toEqual([...firstSeenResources].sort((left, right) => resourceOrder(left) - resourceOrder(right)));
      for (const commit of commits) {
        const expectedDraws = draws
          .filter((draw) => draw.resource === commit.resource)
          .sort((left, right) => left.view - right.view);
        expect(commit.submissions, `${label} ${commit.resource} sorted isolated views`).toEqual(
          expectedDraws.map((draw) => committedSubmission([draw.page])),
        );
        expect(commit.submissions, `${label} ${commit.resource} one lane per repeated draw group`)
          .toHaveLength(expectedDraws.length);
        const start = expectedDraws.length <= 1
          ? 0
          : cursors.get(commit.resource)! % expectedDraws.length;
        expect(commit.startSubmission, `${label} ${commit.resource} normalized cursor`).toBe(start);
        expect(commit.nextStartSubmission, `${label} ${commit.resource} next cursor`).toBe(
          expectedDraws.length <= 1 ? 0 : (start + 1) % expectedDraws.length,
        );
      }
    });
  });

  it("aborts without commits or cursor advancement and can reuse the workspace", () => {
    const workspace = createVirtualTextureFrameDemandWorkspace<string>();
    let cursorReads = 0;
    beginVirtualTextureFrameDemand(workspace);
    submitVirtualTextureFrameDemand(workspace, "surface", 0, submission([page(0)]));
    submitVirtualTextureFrameDemand(workspace, "surface", 1, submission([page(1)]));

    expect(finalizeVirtualTextureFrameDemand(workspace, false, () => {
      cursorReads += 1;
      return 1;
    })).toEqual([]);
    expect(cursorReads).toBe(0);

    beginVirtualTextureFrameDemand(workspace);
    submitVirtualTextureFrameDemand(workspace, "surface", 0, submission([page(2)]));
    submitVirtualTextureFrameDemand(workspace, "surface", 1, submission([page(3)]));
    const [commit] = finalizeVirtualTextureFrameDemand(workspace, true, () => 1);
    expect(commit).toMatchObject({ nextStartSubmission: 0, startSubmission: 1 });
    expect(commit!.submissions).toEqual([
      committedSubmission([page(2)]),
      committedSubmission([page(3)]),
    ]);
  });

  it("clears committed frame data before the next begin/finalize cycle", () => {
    const workspace = createVirtualTextureFrameDemandWorkspace<string>();
    beginVirtualTextureFrameDemand(workspace);
    submitVirtualTextureFrameDemand(workspace, "old", 0, submission([page(0)]));
    expect(finalizeVirtualTextureFrameDemand(workspace, true, () => 0)).toHaveLength(1);

    beginVirtualTextureFrameDemand(workspace);
    expect(finalizeVirtualTextureFrameDemand(workspace, true, () => 0)).toEqual([]);
  });

  it("reuses the empty result across idle and aborted collections", () => {
    const workspace = createVirtualTextureFrameDemandWorkspace<string>();
    beginVirtualTextureFrameDemand(workspace);
    const idle = finalizeVirtualTextureFrameDemand(workspace, true, () => 0);
    beginVirtualTextureFrameDemand(workspace);
    const repeatedIdle = finalizeVirtualTextureFrameDemand(workspace, true, () => 0);
    beginVirtualTextureFrameDemand(workspace);
    const aborted = finalizeVirtualTextureFrameDemand(workspace, false, () => 0);

    expect(repeatedIdle).toBe(idle);
    expect(aborted).toBe(idle);
  });

  it("reuses resource, view, and group maps after commit and abort without stale demand", () => {
    const workspace = createVirtualTextureFrameDemandWorkspace<string>();
    const first = page(1);
    const second = page(2);
    beginVirtualTextureFrameDemand(workspace);
    submitVirtualTextureFrameDemand(workspace, "first-resource", 4, submission([first]));
    const resourceNode = workspace.resources.get("first-resource")!;
    const viewNode = resourceNode.views.get(4)!;
    const preferredNode = viewNode.preferred;

    finalizeVirtualTextureFrameDemand(workspace, true, () => 0);
    expect(resourceNode.resource).toBeUndefined();
    expect(resourceNode.views.size).toBe(0);
    expect(viewNode.candidates.size).toBe(0);
    expect(viewNode.preferred.size).toBe(0);
    expect(preferredNode.size).toBe(0);

    beginVirtualTextureFrameDemand(workspace);
    submitVirtualTextureFrameDemand(workspace, "second-resource", 7, submission([second]));
    expect(workspace.resources.get("second-resource")).toBe(resourceNode);
    expect(resourceNode.views.get(7)).toBe(viewNode);
    expect(viewNode.preferred).toBe(preferredNode);
    expect([...viewNode.candidates.values()]).toEqual([second]);
    expect([...preferredNode.values()].map((item) => item.page)).toEqual([second]);
    expect(viewNode.candidates.has(virtualTexturePageKey(page(1)))).toBe(false);

    finalizeVirtualTextureFrameDemand(workspace, false, () => 0);
    expect(resourceNode.resource).toBeUndefined();
    expect(resourceNode.views.size).toBe(0);
    expect(viewNode.candidates.size).toBe(0);
    expect(viewNode.preferred.size).toBe(0);
    expect(preferredNode.size).toBe(0);

    beginVirtualTextureFrameDemand(workspace);
    submitVirtualTextureFrameDemand(workspace, "third-resource", 0, submission([first]));
    expect(workspace.resources.get("third-resource")).toBe(resourceNode);
    expect(resourceNode.views.get(0)).toBe(viewNode);
    expect(viewNode.preferred).toBe(preferredNode);
  });

  it("releases active pooled demand when reset by an external lifecycle transition", () => {
    const workspace = createVirtualTextureFrameDemandWorkspace<string>();
    beginVirtualTextureFrameDemand(workspace);
    submitVirtualTextureFrameDemand(workspace, "resource", 3, submission([page(1)]));
    const resourceNode = workspace.resources.get("resource")!;
    const viewNode = resourceNode.views.get(3)!;
    const preferredNode = viewNode.preferred;

    resetVirtualTextureFrameDemand(workspace);

    expect(workspace.active).toBe(false);
    expect(workspace.resources.size).toBe(0);
    expect(resourceNode.resource).toBeUndefined();
    expect(resourceNode.views.size).toBe(0);
    expect(viewNode.candidates.size).toBe(0);
    expect(viewNode.preferred.size).toBe(0);
    expect(preferredNode.size).toBe(0);
  });

  it("caps retained resource and view pools at their high-water limits", () => {
    const workspace = createVirtualTextureFrameDemandWorkspace<string>();

    beginVirtualTextureFrameDemand(workspace);
    for (let resource = 0; resource < 65; resource += 1) {
      submitVirtualTextureFrameDemand(workspace, `resource-${resource}`, 0, submission([page(resource)]));
    }
    finalizeVirtualTextureFrameDemand(workspace, true, () => 0);
    expect(workspace.resourcePool).toHaveLength(64);

    beginVirtualTextureFrameDemand(workspace);
    for (let resource = 0; resource < 33; resource += 1) {
      for (let view = 0; view < VIRTUAL_TEXTURE_FRAME_DEMAND_MAX_RESOURCE_VIEWS; view += 1) {
        submitVirtualTextureFrameDemand(workspace, `views-${resource}`, view, submission([page(view)]), 1_000);
      }
    }
    finalizeVirtualTextureFrameDemand(workspace, false, () => 0);
    expect(workspace.viewPool).toHaveLength(256);
  });

  it("bounds 100k active draws independently of physical capacity and view cardinality", () => {
    const workspace = createVirtualTextureFrameDemandWorkspace<string>();
    let maximumPages = 0;
    let maximumViews = 0;
    beginVirtualTextureFrameDemand(workspace);
    for (let draw = 0; draw < 100_000; draw += 1) {
      const view = draw % 1_000;
      submitVirtualTextureFrameDemand(
        workspace,
        "terrain",
        view,
        submission([page(0, 12), page(draw, 0)]),
        100_000,
      );
      const resource = workspace.resources.get("terrain")!;
      const retainedPages = [...resource.views.values()].reduce((total, lane) => (
        total
        + lane.candidates.size
        + lane.nonconvergentCandidates.size
        + lane.preferred.size
      ), 0);
      maximumPages = Math.max(maximumPages, retainedPages);
      maximumViews = Math.max(maximumViews, resource.views.size);
      if (resource.views.size > VIRTUAL_TEXTURE_FRAME_DEMAND_MAX_RESOURCE_VIEWS) {
        throw new Error("active view-lane bound exceeded during collection");
      }
      if (retainedPages > VIRTUAL_TEXTURE_FRAME_DEMAND_MAX_RESOURCE_PAGES) {
        throw new Error("active page-evidence bound exceeded during collection");
      }
    }
    const resource = workspace.resources.get("terrain")!;
    expect([...resource.views.values()].some((lane) => lane.candidates.has(
      virtualTexturePageKey(page(0, 12)),
    ))).toBe(true);
    expect(maximumPages).toBeGreaterThan(0);
    expect(maximumViews).toBe(VIRTUAL_TEXTURE_FRAME_DEMAND_MAX_RESOURCE_VIEWS);
  });

  it("bounds 100k distinct resources globally and rotates later resources into the window", () => {
    const workspace = createVirtualTextureFrameDemandWorkspace<string>();
    beginVirtualTextureFrameDemand(workspace);
    for (let resource = 0; resource < 100_000; resource += 1) {
      submitBoundedVirtualTextureFrameDemand(
        workspace,
        `terrain-${resource}`,
        resource,
        0,
        1_000,
        submission([page(resource)]),
      );
      if (workspace.resources.size > VIRTUAL_TEXTURE_FRAME_DEMAND_MAX_RESOURCES) {
        throw new Error("active resource bound exceeded during collection");
      }
    }
    expect(workspace.resources.size).toBe(VIRTUAL_TEXTURE_FRAME_DEMAND_MAX_RESOURCES);
    expect(workspace.resourcePoolIndex).toBe(VIRTUAL_TEXTURE_FRAME_DEMAND_MAX_RESOURCES);
    expect(workspace.viewPoolIndex).toBe(VIRTUAL_TEXTURE_FRAME_DEMAND_MAX_RESOURCES);

    const rotating = createVirtualTextureFrameDemandWorkspace<string>();
    const publish = (): readonly string[] => {
      beginVirtualTextureFrameDemand(rotating);
      for (let resource = 0; resource < 100; resource += 1) {
        submitBoundedVirtualTextureFrameDemand(
          rotating,
          `rotating-${resource}`,
          resource,
          0,
          4,
          submission([page(resource)]),
        );
      }
      const commits = finalizeVirtualTextureFrameDemand(rotating, true, () => 0);
      for (const commit of commits) advanceVirtualTextureFrameDemand(rotating, commit);
      return commits.map((commit) => commit.resource);
    };
    expect(publish()).toContain("rotating-63");
    const second = publish();
    expect(second).toContain("rotating-64");
    expect(second).toContain("rotating-99");
  });

  it("rotates bounded view lanes without starvation and preserves stereo lanes", () => {
    const workspace = createVirtualTextureFrameDemandWorkspace<string>();
    const seen = new Set<number>();
    for (let frame = 0; frame < 5; frame += 1) {
      beginVirtualTextureFrameDemand(workspace);
      const views = Array.from({ length: 40 }, (_value, view) => view);
      if (frame % 2 === 1) views.reverse();
      for (const view of views) {
        submitVirtualTextureFrameDemand(workspace, "xr", view, submission([page(view)]), 1_000);
      }
      const retainedViews = [...workspace.resources.get("xr")!.views.keys()];
      for (const view of retainedViews) seen.add(view);
      const [commit] = finalizeVirtualTextureFrameDemand(workspace, true, () => 0);
      if (frame === 0) {
        expect(retainedViews).toContain(0);
        expect(retainedViews).toContain(1);
      }
      advanceVirtualTextureFrameDemand(workspace, commit!);
    }
    expect(seen).toEqual(new Set(Array.from({ length: 40 }, (_value, view) => view)));
    expect(workspace.viewCursors.has("xr")).toBe(true);
  });

  it("is deterministic under reversed draw order while retaining coarse and local evidence", () => {
    const collect = (reverse: boolean) => {
      const workspace = createVirtualTextureFrameDemandWorkspace<string>();
      const draws = Array.from({ length: 200 }, (_value, draw) => ({
        candidates: [page(0, 9), page(draw, draw % 3)],
        preferredCandidates: [page(draw, draw % 3)],
      }));
      if (reverse) draws.reverse();
      beginVirtualTextureFrameDemand(workspace);
      for (const draw of draws) {
        submitBoundedVirtualTextureFrameDemand(workspace, "map", resourceOrder("map"), 0, 24, {
          ...draw,
          preferTargetMip: true,
        });
      }
      return finalizeVirtualTextureFrameDemand(workspace, true, () => 0)[0]!.submissions;
    };
    const forward = collect(false);
    const reverse = collect(true);
    expect(reverse[0]!.preferredCandidates).toEqual(forward[0]!.preferredCandidates);
    expect(forward[0]!.candidates[0]).toEqual(page(0, 9));
    expect(reverse[0]!.candidates[0]).toEqual(page(0, 9));
  });

  it("releases all persistent fairness state under resource and view churn", () => {
    const workspace = createVirtualTextureFrameDemandWorkspace<string>();
    for (let resourceIndex = 0; resourceIndex < 256; resourceIndex += 1) {
      const resource = `resource-${resourceIndex}`;
      beginVirtualTextureFrameDemand(workspace);
      for (let view = 0; view < 100; view += 1) {
        submitVirtualTextureFrameDemand(workspace, resource, view, submission([page(view)]), 32);
      }
      const [commit] = finalizeVirtualTextureFrameDemand(workspace, true, () => 0);
      advanceVirtualTextureFrameDemand(workspace, commit!);
      releaseVirtualTextureFrameDemandResource(workspace, resource);
    }
    expect(workspace.viewCursors.size).toBe(0);
    expect(workspace.resources.size).toBe(0);
    expect(workspace.resourcePool.every((resource) => resource.commit === undefined)).toBe(true);
  });
});
