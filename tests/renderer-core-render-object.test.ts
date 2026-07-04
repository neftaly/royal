import { describe, expect, it } from "vitest";
import {
  createRenderObjectHandle,
  createRenderObjectTransformState,
  reduceRenderObjectTransform,
  renderObjectTransformStateToTransform,
  type RenderObjectTransformState,
} from "@royal/renderer-core/internal/render-object";

const identityTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
} satisfies RenderObjectTransformState;

describe("renderer-core render object transforms", () => {
  it("reduces transform actions without mutating prior state", () => {
    const sourcePosition: [number, number, number] = [0, 0, 0];
    const state = createRenderObjectTransformState({
      ...identityTransform,
      position: sourcePosition,
    });

    sourcePosition[0] = 9;
    expect(state.position).toEqual([0, 0, 0]);

    const sameState = reduceRenderObjectTransform(state, {
      component: "x",
      field: "position",
      type: "set-component",
      value: 0,
    });
    expect(sameState).toBe(state);

    const moved = reduceRenderObjectTransform(state, {
      component: "x",
      field: "position",
      type: "set-component",
      value: 2,
    });
    expect(moved).not.toBe(state);
    expect(moved.position).toEqual([2, 0, 0]);
    expect(state.position).toEqual([0, 0, 0]);
    expect(moved.rotation).toBe(state.rotation);

    const incomingScale: [number, number, number] = [2, 3, 4];
    const scaled = reduceRenderObjectTransform(moved, {
      field: "scale",
      type: "set-vector",
      value: incomingScale,
    });
    incomingScale[0] = 99;
    expect(scaled.scale).toEqual([2, 3, 4]);
    expect(moved.scale).toEqual([1, 1, 1]);
  });

  it("applies partial transform actions and snapshots state as transform data", () => {
    const state = createRenderObjectTransformState(identityTransform);

    expect(reduceRenderObjectTransform(state, {
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      },
      type: "set-transform",
    })).toBe(state);

    const next = reduceRenderObjectTransform(state, {
      transform: {
        position: [1, 2, 3],
        rotation: [0.1, 0.2, 0.3],
      },
      type: "set-transform",
    });
    expect(next).toEqual({
      position: [1, 2, 3],
      rotation: [0.1, 0.2, 0.3],
      scale: [1, 1, 1],
    });

    const snapshot = renderObjectTransformStateToTransform(next);
    expect(snapshot).toEqual(next);
    expect(snapshot.position).not.toBe(next.position);
    expect(snapshot.rotation).not.toBe(next.rotation);
    expect(snapshot.scale).not.toBe(next.scale);
  });

  it("keeps RenderObjectHandle notifications compatible and no-op aware", () => {
    let notifications = 0;
    const handle = createRenderObjectHandle(identityTransform, () => {
      notifications += 1;
    });

    expect(handle.getTransform()).toEqual(identityTransform);

    handle.position.x = 1;
    expect(notifications).toBe(1);
    expect(handle.position.toArray()).toEqual([1, 0, 0]);
    expect(handle.getTransform().position).toEqual([1, 0, 0]);

    handle.position.x = 1;
    handle.position.set([1, 0, 0]);
    handle.setTransform({
      position: [1, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    });
    expect(notifications).toBe(1);

    handle.setTransform({
      position: [2, 3, 4],
      scale: [5, 5, 5],
    });
    expect(notifications).toBe(2);
    expect(handle.position.toArray()).toEqual([2, 3, 4]);
    expect(handle.scale.toArray()).toEqual([5, 5, 5]);

    handle.rotation.set(0.1, 0.2, 0.3);
    expect(notifications).toBe(3);
    expect(handle.getTransform()).toEqual({
      position: [2, 3, 4],
      rotation: [0.1, 0.2, 0.3],
      scale: [5, 5, 5],
    });

    handle.scale.z = 5;
    expect(notifications).toBe(3);
  });

  it("assigns stable numeric render object ids", () => {
    const first = createRenderObjectHandle(identityTransform, () => {});
    const second = createRenderObjectHandle(identityTransform, () => {});

    expect(Number.isInteger(first.renderObjectId)).toBe(true);
    expect(Number.isInteger(second.renderObjectId)).toBe(true);
    expect(first.renderObjectId).not.toBe(second.renderObjectId);

    const firstId = first.renderObjectId;
    first.position.x = 1;
    first.setTransform({
      position: [2, 3, 4],
      rotation: [0.1, 0.2, 0.3],
      scale: [2, 2, 2],
    });
    expect(first.renderObjectId).toBe(firstId);
  });

  it("tracks monotonic handle versions for changed transform fields only", () => {
    let notifications = 0;
    const handle = createRenderObjectHandle(identityTransform, () => {
      notifications += 1;
    });

    expect(handle.transformVersion).toBe(0);
    expect(handle.positionVersion).toBe(0);
    expect(handle.rotationVersion).toBe(0);
    expect(handle.scaleVersion).toBe(0);

    handle.position.x = 1;
    expect(notifications).toBe(1);
    expect(handle.transformVersion).toBe(1);
    expect(handle.positionVersion).toBe(1);
    expect(handle.rotationVersion).toBe(0);
    expect(handle.scaleVersion).toBe(0);

    handle.position.x = 1;
    handle.position.set([1, 0, 0]);
    handle.setTransform({
      position: [1, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    });
    expect(notifications).toBe(1);
    expect(handle.transformVersion).toBe(1);
    expect(handle.positionVersion).toBe(1);
    expect(handle.rotationVersion).toBe(0);
    expect(handle.scaleVersion).toBe(0);

    handle.setTransform({
      position: [2, 3, 4],
      rotation: [0.1, 0.2, 0.3],
      scale: [1, 1, 1],
    });
    expect(notifications).toBe(2);
    expect(handle.transformVersion).toBe(2);
    expect(handle.positionVersion).toBe(2);
    expect(handle.rotationVersion).toBe(1);
    expect(handle.scaleVersion).toBe(0);

    handle.scale.set(2, 2, 2);
    expect(notifications).toBe(3);
    expect(handle.transformVersion).toBe(3);
    expect(handle.positionVersion).toBe(2);
    expect(handle.rotationVersion).toBe(1);
    expect(handle.scaleVersion).toBe(1);
  });

  it("keeps RenderObjectHandle transform snapshots defensive", () => {
    const handle = createRenderObjectHandle(identityTransform, () => {});

    const firstSnapshot = handle.getTransform();
    (firstSnapshot.position as [number, number, number])[0] = 99;
    (firstSnapshot.rotation as [number, number, number])[1] = 99;
    (firstSnapshot.scale as [number, number, number])[2] = 99;

    expect(handle.getTransform()).toEqual(identityTransform);

    handle.setTransform({
      position: [1, 2, 3],
      rotation: [0.1, 0.2, 0.3],
      scale: [4, 5, 6],
    });

    const secondSnapshot = handle.getTransform();
    const thirdSnapshot = handle.getTransform();
    expect(secondSnapshot).toEqual(thirdSnapshot);
    expect(secondSnapshot.position).not.toBe(thirdSnapshot.position);
    expect(secondSnapshot.rotation).not.toBe(thirdSnapshot.rotation);
    expect(secondSnapshot.scale).not.toBe(thirdSnapshot.scale);
  });

  it("keeps mutable vector argument validation", () => {
    const handle = createRenderObjectHandle(identityTransform, () => {});
    const setPosition = handle.position.set.bind(handle.position) as unknown as (x: number, y: number) => void;

    expect(() => {
      setPosition(1, 2);
    }).toThrow(/expects x, y, and z/);
  });
});
