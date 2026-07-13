import { describe, expect, it } from "vitest";
import {
  advanceVirtualTextureFrameDemand,
  beginVirtualTextureFrameDemand,
  createVirtualTextureFrameDemandWorkspace,
  finalizeVirtualTextureFrameDemand,
  resetVirtualTextureFrameDemand,
  submitVirtualTextureFrameDemand,
} from "../packages/renderer-webgl/src/virtual-texture-frame-demand";
import {
  selectVirtualTextureFrameWorkingSet,
  type VirtualTextureDemandSubmission,
} from "../packages/renderer-webgl/src/virtual-texture-demand";
import type { VirtualTexturePageId } from "../packages/renderer-webgl/src/virtual-texturing";
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

describe("virtual texture frame-demand workspace", () => {
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

  it("does not let a later conservative draw replace an earlier draw's target preference", () => {
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

  it("rotates distinct draw groups within one view without weighting duplicate draws", () => {
    const workspace = createVirtualTextureFrameDemandWorkspace<string>();
    const parent = page(0, 2);
    const left = page(0);
    const right = page(3);
    const selectFrame = (): readonly VirtualTexturePageId[] => {
      beginVirtualTextureFrameDemand(workspace);
      for (let draw = 0; draw < 100; draw += 1) {
        submitVirtualTextureFrameDemand(workspace, "surface", 0, submission([parent, left]));
      }
      submitVirtualTextureFrameDemand(workspace, "surface", 0, submission([parent, right]));
      expect(workspace.resources.get("surface")!.views.get(0)!.preferredGroups.size).toBe(2);
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
    expect(selectFrame()).toEqual([parent, right]);
    expect(selectFrame()).toEqual([parent, left]);
  });

  it("advances group preference only after publication and accepts a retained prepared commit", () => {
    const workspace = createVirtualTextureFrameDemandWorkspace<string>();
    const parent = page(0, 2);
    const left = page(0);
    const right = page(3);
    const prepare = () => {
      beginVirtualTextureFrameDemand(workspace);
      submitVirtualTextureFrameDemand(workspace, "surface", 0, submission([parent, left]));
      submitVirtualTextureFrameDemand(workspace, "surface", 0, submission([parent, right]));
      return finalizeVirtualTextureFrameDemand(workspace, true, () => 0)[0]!;
    };
    const select = (commit: ReturnType<typeof prepare>) =>
      selectVirtualTextureFrameWorkingSet(commit.submissions, 2, commit.startSubmission);

    const retained = prepare();
    expect(select(retained)).toEqual([parent, left]);
    const unpublishedRetry = prepare();
    expect(select(unpublishedRetry)).toEqual([parent, left]);
    expect(select(retained)).toEqual([parent, left]);
    expect(workspace.preferenceCursors.get("surface")).toBeUndefined();

    // The first prepared result remains a valid acknowledgment even after the
    // collection pools have been reused to prepare another frame.
    advanceVirtualTextureFrameDemand(workspace, retained);
    expect(select(prepare())).toEqual([parent, right]);
  });

  it("does not advance group preference when collection aborts", () => {
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
    expect(workspace.preferenceCursors.get("surface")).toBeUndefined();
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
          );
        }
      }

      const commits = finalizeVirtualTextureFrameDemand(
        workspace,
        true,
        (resource) => cursors.get(resource)!,
      );
      expect(commits.map((commit) => commit.resource), `${label} resource encounter order`)
        .toEqual(firstSeenResources);
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

  it("reuses resource, view, and group maps after commit and abort without stale demand", () => {
    const workspace = createVirtualTextureFrameDemandWorkspace<string>();
    const first = page(1);
    const second = page(2);
    beginVirtualTextureFrameDemand(workspace);
    submitVirtualTextureFrameDemand(workspace, "first-resource", 4, submission([first]));
    const resourceNode = workspace.resources.get("first-resource")!;
    const viewNode = resourceNode.views.get(4)!;
    const groupNode = [...viewNode.preferredGroups.values()][0]!;

    finalizeVirtualTextureFrameDemand(workspace, true, () => 0);
    expect(resourceNode.resource).toBeUndefined();
    expect(resourceNode.views.size).toBe(0);
    expect(viewNode.candidates.size).toBe(0);
    expect(viewNode.preferredGroups.size).toBe(0);
    expect(groupNode.size).toBe(0);

    beginVirtualTextureFrameDemand(workspace);
    submitVirtualTextureFrameDemand(workspace, "second-resource", 7, submission([second]));
    expect(workspace.resources.get("second-resource")).toBe(resourceNode);
    expect(resourceNode.views.get(7)).toBe(viewNode);
    expect([...viewNode.preferredGroups.values()][0]).toBe(groupNode);
    expect([...viewNode.candidates.values()]).toEqual([second]);
    expect([...groupNode.values()]).toEqual([second]);
    expect(viewNode.candidates.has("0/1/0")).toBe(false);

    finalizeVirtualTextureFrameDemand(workspace, false, () => 0);
    expect(resourceNode.resource).toBeUndefined();
    expect(resourceNode.views.size).toBe(0);
    expect(viewNode.candidates.size).toBe(0);
    expect(viewNode.preferredGroups.size).toBe(0);
    expect(groupNode.size).toBe(0);

    beginVirtualTextureFrameDemand(workspace);
    submitVirtualTextureFrameDemand(workspace, "third-resource", 0, submission([first]));
    expect(workspace.resources.get("third-resource")).toBe(resourceNode);
    expect(resourceNode.views.get(0)).toBe(viewNode);
    expect([...viewNode.preferredGroups.values()][0]).toBe(groupNode);
  });

  it("releases active pooled demand when reset by an external lifecycle transition", () => {
    const workspace = createVirtualTextureFrameDemandWorkspace<string>();
    beginVirtualTextureFrameDemand(workspace);
    submitVirtualTextureFrameDemand(workspace, "resource", 3, submission([page(1)]));
    const resourceNode = workspace.resources.get("resource")!;
    const viewNode = resourceNode.views.get(3)!;
    const groupNode = [...viewNode.preferredGroups.values()][0]!;

    resetVirtualTextureFrameDemand(workspace);

    expect(workspace.active).toBe(false);
    expect(workspace.resources.size).toBe(0);
    expect(resourceNode.resource).toBeUndefined();
    expect(resourceNode.views.size).toBe(0);
    expect(viewNode.candidates.size).toBe(0);
    expect(viewNode.preferredGroups.size).toBe(0);
    expect(groupNode.size).toBe(0);
  });

  it("caps retained resource, view, and group pools at their high-water limits", () => {
    const workspace = createVirtualTextureFrameDemandWorkspace<string>();

    beginVirtualTextureFrameDemand(workspace);
    for (let resource = 0; resource < 65; resource += 1) {
      submitVirtualTextureFrameDemand(workspace, `resource-${resource}`, 0, submission([page(resource)]));
    }
    finalizeVirtualTextureFrameDemand(workspace, true, () => 0);
    expect(workspace.resourcePool).toHaveLength(64);

    beginVirtualTextureFrameDemand(workspace);
    for (let view = 0; view < 257; view += 1) {
      submitVirtualTextureFrameDemand(workspace, "views", view, submission([page(view)]));
    }
    finalizeVirtualTextureFrameDemand(workspace, false, () => 0);
    expect(workspace.viewPool).toHaveLength(256);

    beginVirtualTextureFrameDemand(workspace);
    for (let group = 0; group < 513; group += 1) {
      submitVirtualTextureFrameDemand(workspace, "groups", 0, submission([page(group)]));
    }
    finalizeVirtualTextureFrameDemand(workspace, true, () => 0);
    expect(workspace.groupPool).toHaveLength(512);
  });
});
