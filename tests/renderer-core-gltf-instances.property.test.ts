import { describe, expect, it, vi } from "vitest";
import {
  createGltfInstanceTransforms,
  type GltfInstanceTransformChannel,
} from "@royal/renderer-core";
import { assertFuzzArrayEqual, assertFuzzEqual, forEachFuzzCase } from "./fuzz";

describe("glTF instance transform properties", () => {
  it("keeps pose and scale commits independent across randomized updates", () => {
    forEachFuzzCase({ cases: 64, seed: 0x1a57_a11 }, ({ random }) => {
      const count = random.int(1, 129);
      const scales = new Float32Array(count * 3);
      for (let index = 0; index < scales.length; index += 1) {
        scales[index] = random.number(0.01, 4);
      }
      const transforms = createGltfInstanceTransforms({ count, scales });
      const initialScales = transforms.scales.slice();
      const initialScaleVersion = transforms.scaleVersion;
      let calls = 0;
      let secondRootCalls = 0;
      let lastPoseCount = 0;
      let lastPoseVersion = 0;
      const listener = (kind: GltfInstanceTransformChannel, _start: number, committedCount: number, version: number): void => {
        calls += 1;
        if (kind === "pose") {
          lastPoseCount = committedCount;
          lastPoseVersion = version;
        }
      };
      const secondRootListener = (): void => { secondRootCalls += 1; };
      const unsubscribe = transforms.subscribe(listener);
      const unsubscribeSecondRoot = transforms.subscribe(secondRootListener);

      for (let update = 0; update < 32; update += 1) {
        const instanceIndex = random.int(0, count);
        const offset = instanceIndex * 3;
        transforms.positions[offset] = random.number(-100, 100);
        transforms.positions[offset + 1] = random.number(-100, 100);
        transforms.positions[offset + 2] = random.number(-100, 100);
        transforms.rotations[offset] = random.number(-Math.PI, Math.PI);
        transforms.rotations[offset + 1] = random.number(-Math.PI, Math.PI);
        transforms.rotations[offset + 2] = random.number(-Math.PI, Math.PI);
        const previousPoseVersion = transforms.poseVersion;
        transforms.commitPose(instanceIndex, 1);

        assertFuzzEqual(transforms.poseVersion, previousPoseVersion + 1, "pose version");
        assertFuzzEqual(transforms.scaleVersion, initialScaleVersion, "scale version");
      }
      assertFuzzEqual(calls, 32, "primary listener calls");
      assertFuzzEqual(secondRootCalls, 32, "secondary listener calls");
      assertFuzzEqual(lastPoseCount, 1, "last pose count");
      assertFuzzEqual(lastPoseVersion, transforms.poseVersion, "last pose version");
      assertFuzzArrayEqual(transforms.scales, initialScales, "scales");

      unsubscribe();
      transforms.commitPose();
      assertFuzzEqual(calls, 32, "unsubscribed primary listener calls");
      assertFuzzEqual(secondRootCalls, 33, "remaining secondary listener calls");
      unsubscribeSecondRoot();
    });
  });

  it('reports the narrowest committed channel while sharing pose versions', () => {
    const transforms = createGltfInstanceTransforms({ count: 2 });
    const notifications: Array<[GltfInstanceTransformChannel, number, number, number]> = [];
    transforms.subscribe((...notification) => notifications.push(notification));

    transforms.positions[3] = 1;
    transforms.commitPosition(1, 1);
    transforms.rotations[0] = 0.5;
    transforms.commitRotation(0, 1);
    transforms.commitPose();
    transforms.commitScale(1, 1);

    expect(notifications).toEqual([
      ['position', 1, 1, 2],
      ['rotation', 0, 1, 3],
      ['pose', 0, 2, 4],
      ['scale', 1, 1, 2],
    ]);
    expect(transforms.poseVersion).toBe(4);
    expect(transforms.scaleVersion).toBe(2);
  });

  it('validates only the channel named by narrow commits', () => {
    const transforms = createGltfInstanceTransforms({ count: 1 });
    transforms.rotations[0] = Number.NaN;
    expect(() => transforms.commitPosition()).not.toThrow();
    expect(() => transforms.commitRotation()).toThrow(/finite/);

    transforms.rotations[0] = 0;
    transforms.positions[0] = Number.NaN;
    expect(() => transforms.commitRotation()).not.toThrow();
    expect(() => transforms.commitPosition()).toThrow(/finite/);
  });

  it('rejects non-finite committed values and snapshots unique logical ids', () => {
    const ids = ['left', 'right'];
    const transforms = createGltfInstanceTransforms({ count: 2, logicalIds: ids });
    ids[0] = 'mutated';
    expect(transforms.logicalIds).toEqual(['left', 'right']);
    expect(Object.isFrozen(transforms.logicalIds)).toBe(true);
    expect(() => createGltfInstanceTransforms({ count: 2, logicalIds: ['same', 'same'] })).toThrow(/unique/);

    transforms.positions[3] = Number.NaN;
    expect(() => transforms.commitPose(1, 1)).toThrow(/finite/);
    transforms.positions[3] = 0;
    transforms.scales[3] = Number.POSITIVE_INFINITY;
    expect(() => transforms.commitScale(1, 1)).toThrow(/finite and non-negative/);
  });

  it('notifies the stable listener cohort best-effort before rethrowing the first failure', () => {
    const transforms = createGltfInstanceTransforms({ count: 1 });
    const calls: string[] = [];
    let unsubscribeSecond = (): void => {};
    transforms.subscribe(() => {
      calls.push('first');
      unsubscribeSecond();
      transforms.subscribe(() => calls.push('late'));
      throw new Error('first listener failed');
    });
    unsubscribeSecond = transforms.subscribe(() => calls.push('second'));

    expect(() => transforms.commitPose()).toThrow('first listener failed');
    expect(calls).toEqual(['first', 'second']);
    expect(transforms.poseVersion).toBe(2);

    calls.length = 0;
    expect(() => transforms.commitScale()).toThrow('first listener failed');
    expect(calls).toEqual(['first', 'late']);
    expect(transforms.scaleVersion).toBe(2);
  });

  it('owns duplicate callback subscriptions independently', () => {
    const transforms = createGltfInstanceTransforms({ count: 1 });
    const listener = vi.fn();
    const unsubscribeFirst = transforms.subscribe(listener);
    const unsubscribeSecond = transforms.subscribe(listener);

    transforms.commitPose();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribeFirst();
    transforms.commitPose();
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribeSecond();
    transforms.commitPose();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('rejects reentrant commits before subscriber versions can be inverted', () => {
    const transforms = createGltfInstanceTransforms({ count: 1 });
    const versions: number[] = [];
    transforms.subscribe((_channel, _start, _count, version) => {
      versions.push(version);
      transforms.commitScale();
    });
    transforms.subscribe((_channel, _start, _count, version) => versions.push(version));

    expect(() => transforms.commitPose()).toThrow(/cannot run from.*subscriber/);
    expect(versions).toEqual([2, 2]);
    expect(transforms.poseVersion).toBe(2);
    expect(transforms.scaleVersion).toBe(1);
  });
});
