import { describe, expect, it } from 'vitest';
import {
  GltfInstanceChangeTracker,
  createInstanceDirtyBits,
  isInstanceDirty,
  isPackedInstanceSlotDirty,
  markInstanceDirtyRange,
} from '../packages/renderer-webgl/src/gltf/instance-changes';
import { assertFuzzEqual, forEachFuzzCase } from './fuzz';

describe('bulk instance change tracking', () => {
  it('matches exact dirty rows and packed-slot oracle across randomized commits and repacks', () => {
    forEachFuzzCase({ cases: 96, seed: 0xb017_cafe }, ({ label, random }) => {
      const count = random.int(1, 1025);
      const dirty = createInstanceDirtyBits(count);
      const oracle = new Uint8Array(count);
      for (let commit = 0; commit < 48; commit += 1) {
        const start = random.int(0, count);
        const rangeCount = random.int(1, count - start + 1);
        markInstanceDirtyRange(dirty, start, rangeCount);
        oracle.fill(1, start, start + rangeCount);
      }
      for (let index = 0; index < count; index += 1) {
        assertFuzzEqual(isInstanceDirty(dirty, index), oracle[index] === 1, `row=${index}`);
      }

      for (let slot = 0; slot < count; slot += 1) {
        const previousIndex = random.int(0, count);
        const nextIndex = random.int(0, count);
        const sameSource = random.int(0, 2) === 1;
        const versionChanged = random.int(0, 2) === 1;
        const expected = !sameSource
          || previousIndex !== nextIndex
          || (versionChanged && oracle[nextIndex] === 1);
        assertFuzzEqual(isPackedInstanceSlotDirty(
          dirty,
          nextIndex,
          sameSource,
          previousIndex,
          versionChanged,
        ), expected, `${label} slot=${slot}`);
      }
    });
  });

  it('keeps active and pending generations independent for commits during submit', () => {
    const tracker = new GltfInstanceChangeTracker(128);
    tracker.beginFrame();
    expect(isInstanceDirty(tracker.activePose, 42)).toBe(true);
    tracker.beginFrame();
    expect(isInstanceDirty(tracker.activePose, 42)).toBe(false);
    tracker.commit('pose', 77, 1);
    expect(isInstanceDirty(tracker.activePose, 77)).toBe(false);
    expect(isInstanceDirty(tracker.pendingPose, 77)).toBe(true);

    tracker.beginFrame();
    expect(isInstanceDirty(tracker.activePose, 42)).toBe(false);
    expect(isInstanceDirty(tracker.activePose, 77)).toBe(true);
  });

  it('tracks position and rotation work at their narrowest shared layers', () => {
    const tracker = new GltfInstanceChangeTracker(8);
    tracker.beginFrame();
    tracker.beginFrame();

    tracker.commit('position', 1, 1);
    tracker.commit('rotation', 3, 1);
    tracker.commit('pose', 5, 1);
    tracker.beginFrame();

    expect(isInstanceDirty(tracker.activePose, 1)).toBe(true);
    expect(isInstanceDirty(tracker.activeRotation, 1)).toBe(false);
    expect(isInstanceDirty(tracker.activePose, 3)).toBe(true);
    expect(isInstanceDirty(tracker.activeRotation, 3)).toBe(true);
    expect(isInstanceDirty(tracker.activePose, 5)).toBe(true);
    expect(isInstanceDirty(tracker.activeRotation, 5)).toBe(true);

    tracker.abortFrame();
    tracker.beginFrame();
    expect(isInstanceDirty(tracker.activePose, 1)).toBe(true);
    expect(isInstanceDirty(tracker.activeRotation, 3)).toBe(true);
  });
});
