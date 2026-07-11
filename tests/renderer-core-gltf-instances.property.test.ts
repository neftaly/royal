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
});
