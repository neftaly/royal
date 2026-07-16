import { describe, expect, it } from "vitest";
import {
  createGltfInstanceTransforms,
  type GltfInstanceTransforms,
  type GltfInstanceTransformsListener,
} from "@royal/renderer-core";
import {
  GltfInstanceTransformRegistry,
  type GltfInstanceTransformReferenceChange,
} from "../packages/renderer-webgl/src/gltf/instance-transform-registry";
import { isInstanceDirty } from "../packages/renderer-webgl/src/gltf/instance-changes";
import { transformMat4 } from "../packages/renderer-webgl/src/math/mat4";
import { assertFuzzArrayEqual, forEachFuzzCase } from "./fuzz";

type TrackedSource = {
  readonly activeSubscriptions: () => number;
  readonly source: GltfInstanceTransforms;
  readonly unsubscribeAttempts: () => number;
};

const trackedSource = (count: number, unsubscribeFailures = 0): TrackedSource => {
  const source = createGltfInstanceTransforms({ count });
  let activeSubscriptions = 0;
  let unsubscribeAttempts = 0;
  const tracked: GltfInstanceTransforms = {
    commitPosition: source.commitPosition,
    commitPose: source.commitPose,
    commitRotation: source.commitRotation,
    commitScale: source.commitScale,
    count: source.count,
    ...(source.logicalIds === undefined ? {} : { logicalIds: source.logicalIds }),
    get poseVersion() {
      return source.poseVersion;
    },
    positions: source.positions,
    rotations: source.rotations,
    get scaleVersion() {
      return source.scaleVersion;
    },
    scales: source.scales,
    subscribe(listener: GltfInstanceTransformsListener) {
      activeSubscriptions += 1;
      const unsubscribe = source.subscribe(listener);
      let active = true;
      return () => {
        unsubscribeAttempts += 1;
        if (unsubscribeAttempts <= unsubscribeFailures) throw new Error("unsubscribe failed");
        if (!active) return;
        active = false;
        activeSubscriptions -= 1;
        unsubscribe();
      };
    },
  };
  return {
    activeSubscriptions: () => activeSubscriptions,
    source: tracked,
    unsubscribeAttempts: () => unsubscribeAttempts,
  };
};

const change = (
  resource: GltfInstanceTransforms,
  previousCount: number,
  nextCount: number,
): GltfInstanceTransformReferenceChange => ({ nextCount, previousCount, resource });

const expectMatricesCurrent = (
  registry: GltfInstanceTransformRegistry,
  source: GltfInstanceTransforms,
): void => {
  const views = registry.views(source);
  for (let index = 0; index < source.count; index += 1) {
    assertFuzzArrayEqual(
      views.rootModels[index]!,
      transformMat4(views.transforms[index]!),
      `root model ${index}`,
    );
    const offset = index * 3;
    expect(views.orientationPreserving[index], `orientation ${index}`).toBe(
      source.scales[offset]! * source.scales[offset + 1]! * source.scales[offset + 2]! >= 0 ? 1 : 0,
    );
  }
};

describe("glTF instance transform registry", () => {
  it("owns subscriptions, invalidation, stable views, and exact matrix materialization", () => {
    const tracked = trackedSource(3);
    let invalidations = 0;
    const registry = new GltfInstanceTransformRegistry(() => { invalidations += 1; });
    registry.reconcile([change(tracked.source, 0, 2)]);
    registry.reconcile([change(tracked.source, 2, 3)]);

    const initial = registry.views(tracked.source);
    expect(tracked.activeSubscriptions()).toBe(1);
    expect(registry.views(tracked.source)).toBe(initial);
    expect(initial.positions).toBe(tracked.source.positions);
    expect(initial.rotations).toBe(tracked.source.rotations);
    expect(initial.scales).toBe(tracked.source.scales);
    expectMatricesCurrent(registry, tracked.source);
    registry.beginFrame();
    registry.views(tracked.source);
    registry.endFrame(true);

    tracked.source.positions[3] = 4;
    tracked.source.rotations[5] = 0.25;
    tracked.source.commitPose(1, 1);
    tracked.source.scales[6] = 2;
    tracked.source.commitScale(2, 1);
    expect(invalidations).toBe(2);

    registry.beginFrame();
    const views = registry.views(tracked.source);
    expect(isInstanceDirty(views.changes.activePose, 0)).toBe(false);
    expect(isInstanceDirty(views.changes.activePose, 1)).toBe(true);
    expect(isInstanceDirty(views.changes.activeScale, 2)).toBe(true);
    expectMatricesCurrent(registry, tracked.source);
    registry.endFrame(true);

    registry.reconcile([change(tracked.source, 3, 0)]);
    expect(tracked.activeSubscriptions()).toBe(0);
  });

  it("replays active and mid-frame dirty ranges after an aborted frame", () => {
    const tracked = trackedSource(4);
    const registry = new GltfInstanceTransformRegistry(() => undefined);
    registry.reconcile([change(tracked.source, 0, 1)]);

    tracked.source.positions[0] = 2;
    tracked.source.commitPose(0, 1);
    registry.beginFrame();
    tracked.source.scales[9] = 3;
    tracked.source.commitScale(3, 1);
    registry.endFrame(false);

    registry.beginFrame();
    const views = registry.views(tracked.source);
    expect(isInstanceDirty(views.changes.activePose, 0)).toBe(true);
    expect(isInstanceDirty(views.changes.activeScale, 3)).toBe(true);
    expectMatricesCurrent(registry, tracked.source);
    registry.endFrame(true);

    registry.beginFrame();
    expect(isInstanceDirty(views.changes.activePose, 0)).toBe(false);
    expect(isInstanceDirty(views.changes.activeScale, 3)).toBe(false);
    registry.endFrame(true);
  });

  it("preserves the matrix basis across position commits", () => {
    const tracked = trackedSource(1);
    tracked.source.rotations.set([0.3, -0.4, 0.5]);
    tracked.source.scales.set([2, 3, 4]);
    const registry = new GltfInstanceTransformRegistry(() => undefined);
    registry.reconcile([change(tracked.source, 0, 1)]);
    const initial = registry.views(tracked.source).rootModels[0]!;
    const basis = initial.slice(0, 12);

    tracked.source.positions.set([7, 8, 9]);
    tracked.source.commitPosition();
    registry.beginFrame();
    const translated = registry.views(tracked.source).rootModels[0]!;
    expect(translated.slice(0, 12)).toEqual(basis);
    expect(translated.slice(12, 15)).toEqual([7, 8, 9]);
    expectMatricesCurrent(registry, tracked.source);
    registry.endFrame(true);
  });

  it("updates winding orientation only from synchronized scale", () => {
    const tracked = trackedSource(3);
    tracked.source.scales.set([-1, 1, 1, -1, -2, 1, 0, -1, 1]);
    const registry = new GltfInstanceTransformRegistry(() => undefined);
    registry.reconcile([change(tracked.source, 0, 1)]);
    expect(Array.from(registry.views(tracked.source).orientationPreserving)).toEqual([0, 1, 1]);

    tracked.source.scales.set([1, 1, 1], 0);
    tracked.source.commitScale(0, 1);
    registry.beginFrame();
    expect(Array.from(registry.views(tracked.source).orientationPreserving)).toEqual([1, 1, 1]);
    registry.endFrame(true);
  });

  it("retains failed release and dispose ownership for retry, including opaque failures", () => {
    const releaseTracked = trackedSource(1, 1);
    const opaqueTracked = trackedSource(1);
    const registry = new GltfInstanceTransformRegistry(() => undefined);
    registry.reconcile([
      change(releaseTracked.source, 0, 1),
      change(opaqueTracked.source, 0, 1),
    ]);

    expect(() => registry.reconcile([
      change(releaseTracked.source, 1, 0),
      change(opaqueTracked.source, 1, 0),
    ])).toThrow("unsubscribe failed");
    expect(releaseTracked.activeSubscriptions()).toBe(1);
    expect(opaqueTracked.activeSubscriptions()).toBe(0);

    expect(() => registry.reconcile([change(releaseTracked.source, 1, 0)])).not.toThrow();
    expect(releaseTracked.activeSubscriptions()).toBe(0);

    const opaqueSource = trackedSource(1);
    const opaqueRegistry = new GltfInstanceTransformRegistry(() => undefined);
    const originalSubscribe = opaqueSource.source.subscribe;
    let attempts = 0;
    const source: GltfInstanceTransforms = {
      ...opaqueSource.source,
      subscribe(listener) {
        const unsubscribe = originalSubscribe(listener);
        return () => {
          attempts += 1;
          if (attempts === 1) throw undefined;
          unsubscribe();
        };
      },
    };
    opaqueRegistry.reconcile([change(source, 0, 1)]);
    let failurePresent = false;
    try {
      opaqueRegistry.dispose();
    } catch (error) {
      failurePresent = true;
      expect(error).toBeUndefined();
    }
    expect(failurePresent).toBe(true);
    expect(() => opaqueRegistry.dispose()).not.toThrow();
    expect(attempts).toBe(2);
  });

  it("retries subscription acquisition after reconciliation fails", () => {
    const tracked = trackedSource(1);
    const acquisitionFailure = new Error("subscribe failed");
    let attempts = 0;
    const source: GltfInstanceTransforms = {
      ...tracked.source,
      subscribe(listener) {
        attempts += 1;
        if (attempts === 1) throw acquisitionFailure;
        return tracked.source.subscribe(listener);
      },
    };
    const registry = new GltfInstanceTransformRegistry(() => undefined);
    const acquisition = [change(source, 0, 1)];

    expect(() => registry.reconcile(acquisition)).toThrow(acquisitionFailure);
    expect(tracked.activeSubscriptions()).toBe(0);
    expect(() => registry.reconcile(acquisition)).not.toThrow();
    expect(tracked.activeSubscriptions()).toBe(1);
    expect(attempts).toBe(2);
    registry.dispose();
    expect(tracked.activeSubscriptions()).toBe(0);
  });

  it("keeps source identities stable and rejects exhausted safe-integer IDs", () => {
    const first = createGltfInstanceTransforms({ count: 1 });
    const second = createGltfInstanceTransforms({ count: 1 });
    const registry = new GltfInstanceTransformRegistry(() => undefined, Number.MAX_SAFE_INTEGER);
    expect(registry.views(first).sourceKey).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => registry.views(second)).toThrow(/source ID space is exhausted/);
    expect(registry.views(first).sourceKey).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("matches full matrix recomputation across committed and aborted frame traces", () => {
    forEachFuzzCase({ cases: 64, seed: 0x1a57_ab07 }, ({ label, random }) => {
      const tracked = trackedSource(random.int(1, 65));
      const registry = new GltfInstanceTransformRegistry(() => undefined);
      registry.reconcile([change(tracked.source, 0, 1)]);
      for (let step = 0; step < 48; step += 1) {
        const start = random.int(0, tracked.source.count);
        const count = random.int(1, tracked.source.count - start + 1);
        if (random.boolean()) {
          for (let index = start; index < start + count; index += 1) {
            const offset = index * 3;
            tracked.source.positions[offset] = random.number(-100, 100);
            tracked.source.rotations[offset + 2] = random.number(-Math.PI, Math.PI);
          }
          tracked.source.commitPose(start, count);
        } else {
          for (let index = start; index < start + count; index += 1) {
            tracked.source.scales[index * 3] = random.number(0, 4);
          }
          tracked.source.commitScale(start, count);
        }
        registry.beginFrame();
        if (random.boolean(0.25)) {
          if (random.boolean()) registry.views(tracked.source);
          registry.endFrame(false);
          registry.beginFrame();
        }
        try {
          expectMatricesCurrent(registry, tracked.source);
        } catch (error) {
          throw new Error(`${label} step=${step}`, { cause: error });
        }
        registry.endFrame(true);
      }
      registry.dispose();
    });
  }, 10_000);
});
