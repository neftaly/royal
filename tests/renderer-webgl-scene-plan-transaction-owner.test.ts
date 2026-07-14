import { describe, expect, it } from "vitest";
import {
  boxGeometry,
  directionalLight,
  mesh,
  perspectiveCamera,
  scene,
  unlitMaterial,
  type RenderNode,
  type RenderRoot,
} from "@royal/renderer-core";
import { ScenePlanTransactionOwner } from "../packages/renderer-webgl/src/scene-plan-transaction-owner";

const renderScene = (nodes: readonly RenderNode[] = []): RenderRoot => scene({
  camera: perspectiveCamera({}),
  nodes,
});

describe("WebGL scene-plan transaction owner", () => {
  it("publishes one authoritative generation and retains identical scene identity", () => {
    const calls: string[] = [];
    const owner = new ScenePlanTransactionOwner({
      rebuildTopology: () => calls.push("topology"),
      reconcileBulkInstances: () => calls.push("bulk"),
      reconcileRenderObjectRefs: () => calls.push("refs"),
    });
    const firstScene = renderScene([
      directionalLight({
        color: [0.25, 0.5, 1, 1],
        direction: [0, -1, 0],
        illuminanceLux: 4,
      }),
    ]);
    let resourceApplies = 0;

    const committed = owner.commit(firstScene, () => {
      resourceApplies += 1;
      return "changes";
    });
    expect(committed).toMatchObject({ kind: "committed", resourceChanges: "changes" });
    owner.finishReconciliation();
    const retained = owner.commit(firstScene, () => {
      throw new Error("identical scene must not reapply its delta");
    });

    expect(retained).toMatchObject({ kind: "retained", plan: { revision: 1 } });
    expect(owner.latestScene).toBe(firstScene);
    expect(owner.sceneSurfaceLights).toEqual([{
      color: [1, 2, 4, 1],
      direction: [0, -1, 0],
      kind: "directional",
    }]);
    expect(owner.sceneSurfaceLightSet?.directionals).toHaveLength(1);
    expect(owner.planningSnapshot()).toEqual({
      compileNodeVisits: 1,
      planCompiles: 1,
      planRevision: 1,
      sceneCommits: 1,
    });
    expect(resourceApplies).toBe(1);
    expect(calls).toEqual(["topology", "refs", "bulk"]);
  });

  it("does not publish or consume a revision when semantic resource application fails", () => {
    const owner = new ScenePlanTransactionOwner({
      rebuildTopology: () => undefined,
      reconcileBulkInstances: () => undefined,
      reconcileRenderObjectRefs: () => undefined,
    });
    const nextScene = renderScene();

    expect(() => owner.commit(nextScene, () => {
      throw new Error("resource delta rejected");
    })).toThrow("resource delta rejected");
    expect(owner.plan).toBeUndefined();
    expect(owner.planningSnapshot()).toEqual({
      compileNodeVisits: 0,
      planCompiles: 0,
      planRevision: 0,
      sceneCommits: 0,
    });

    const retry = owner.commit(nextScene, () => undefined);
    expect(retry.plan.revision).toBe(1);
  });

  it("finishes retained reconciliation before admitting another commit", () => {
    const calls: string[] = [];
    let failRef = true;
    const owner = new ScenePlanTransactionOwner({
      rebuildTopology: () => calls.push("topology"),
      reconcileBulkInstances: () => calls.push("bulk"),
      reconcileRenderObjectRefs: () => {
        calls.push("refs");
        if (failRef) {
          failRef = false;
          throw new Error("ref failed");
        }
      },
    });
    const ref = { current: null };
    const committedScene = renderScene([
      mesh({
        geometry: boxGeometry(1),
        material: unlitMaterial({ color: [1, 1, 1, 1] }),
        ref,
      }),
    ]);
    let resourceApplies = 0;
    const commit = owner.commit(committedScene, () => {
      resourceApplies += 1;
      return undefined;
    });

    expect(() => owner.finishReconciliation()).toThrow("ref failed");
    expect(owner.pendingReconciliation).toBe(true);
    expect(owner.latestScene).toBe(committedScene);
    const retained = owner.commit(committedScene, () => {
      resourceApplies += 1;
      return undefined;
    });

    expect(retained.kind).toBe("retained");
    expect(resourceApplies).toBe(1);
    expect(calls).toEqual(["topology", "refs", "bulk", "refs", "bulk"]);
    expect(commit.plan).toBe(owner.plan);
    expect(owner.pendingReconciliation).toBe(false);
  });

  it("preserves an opaque initial failure while completing all reconciliation work", () => {
    const calls: string[] = [];
    const owner = new ScenePlanTransactionOwner({
      rebuildTopology: () => calls.push("topology"),
      reconcileBulkInstances: () => calls.push("bulk"),
      reconcileRenderObjectRefs: () => calls.push("refs"),
    });
    owner.commit(renderScene(), () => undefined);
    let caught = false;

    try {
      owner.finishReconciliation({ value: undefined });
    } catch (value) {
      caught = true;
      expect(value).toBeUndefined();
    }

    expect(caught).toBe(true);
    expect(calls).toEqual(["topology", "refs", "bulk"]);
    expect(owner.pendingReconciliation).toBe(true);
    owner.finishReconciliation();
    expect(calls).toEqual(["topology", "refs", "bulk", "refs", "bulk"]);
  });

  it("rejects a commit re-entered from reconciliation and remains retryable", () => {
    let owner!: ScenePlanTransactionOwner;
    let reenter = true;
    const firstScene = renderScene();
    const secondScene = renderScene();
    owner = new ScenePlanTransactionOwner({
      rebuildTopology: () => undefined,
      reconcileBulkInstances: () => undefined,
      reconcileRenderObjectRefs: () => {
        if (reenter) {
          reenter = false;
          owner.commit(secondScene, () => undefined);
        }
      },
    });
    owner.commit(firstScene, () => undefined);

    expect(() => owner.finishReconciliation()).toThrow(
      "Cannot render while Royal is reconciling render-object refs",
    );
    expect(owner.reconciling).toBe(false);
    expect(owner.pendingReconciliation).toBe(true);
    expect(() => owner.finishReconciliation()).not.toThrow();
  });
});
