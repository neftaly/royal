import { describe, expect, it, vi } from "vitest";
import {
  createGltfInstanceTransforms,
} from "@royal/renderer-core";
import { forEachFuzzCase } from "./fuzz";

describe("glTF instance transform properties", () => {
  it("keeps pose and scale commits independent across randomized updates", () => {
    forEachFuzzCase({ cases: 64, seed: 0x1a57_a11 }, ({ label, random }) => {
      const count = random.int(1, 129);
      const scales = new Float32Array(count * 3);
      for (let index = 0; index < scales.length; index += 1) {
        scales[index] = random.number(0.01, 4);
      }
      const transforms = createGltfInstanceTransforms({ count, scales });
      const initialScales = transforms.scales.slice();
      const initialScaleVersion = transforms.scaleVersion;
      const listener = vi.fn();
      const secondRootListener = vi.fn();
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

        expect(transforms.poseVersion, label).toBe(previousPoseVersion + 1);
        expect(transforms.scaleVersion, label).toBe(initialScaleVersion);
      }
      expect(listener, label).toHaveBeenCalledTimes(32);
      expect(secondRootListener, label).toHaveBeenCalledTimes(32);
      expect(listener, label).toHaveBeenLastCalledWith('pose', expect.any(Number), 1, transforms.poseVersion);
      expect(transforms.scales, label).toEqual(initialScales);

      unsubscribe();
      transforms.commitPose();
      expect(listener, label).toHaveBeenCalledTimes(32);
      expect(secondRootListener, label).toHaveBeenCalledTimes(33);
      unsubscribeSecondRoot();
    });
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
