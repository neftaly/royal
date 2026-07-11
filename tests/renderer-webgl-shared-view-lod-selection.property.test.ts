import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  beginSharedViewLodSelections,
  createSharedViewLodSelections,
  finalizeSharedViewLodSelection,
  NO_SHARED_VIEW_LOD_LEVEL,
  observeSharedViewLodCoverage,
  reserveSharedViewLodSelections,
  sharedViewHystereticLodLevel,
  sharedViewLodSelectedLevel,
  sharedViewLodWasObserved,
  type SharedViewLodMetadata,
  validateSharedViewLodMetadata,
} from "../packages/renderer-webgl/src/gltf/shared-view-lod-selection";
import { forEachFuzzCase, type SeededRandom } from "./fuzz";

const HYSTERESIS = 0.15;

const metadata = (
  thresholds: readonly number[],
  drawable: readonly boolean[],
): SharedViewLodMetadata => validateSharedViewLodMetadata({
  drawableLevels: Uint8Array.from(drawable, (value) => value ? 1 : 0),
  levelCount: thresholds.length,
  offset: 0,
  thresholds: Float64Array.from(thresholds),
});

const referenceHysteretic = (
  coverage: number,
  thresholds: readonly number[],
  previous: number | undefined,
): number => {
  let stateless = thresholds.length - 1;
  for (let level = 0; level < thresholds.length; level += 1) {
    if (coverage >= thresholds[level]!) {
      stateless = level;
      break;
    }
  }
  if (previous === undefined || previous < 0 || previous >= thresholds.length) return stateless;
  let level = previous;
  while (level > 0 && coverage >= Math.min(1, thresholds[level - 1]! * (1 + HYSTERESIS))) level -= 1;
  while (level < thresholds.length - 1 && coverage < thresholds[level]! * (1 - HYSTERESIS)) level += 1;
  return level;
};

const referenceDrawable = (
  target: number,
  previous: number | undefined,
  drawable: readonly boolean[],
): number => {
  if (drawable[target]) return target;
  if (previous !== undefined && drawable[previous]) return previous;
  const first = drawable.findIndex(Boolean);
  return first < 0 ? target : first;
};

const shuffled = (values: readonly number[], random: SeededRandom): number[] => {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = random.int(0, index + 1);
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
};

const select = (
  coverage: readonly number[],
  lod: SharedViewLodMetadata,
  previous?: number,
): number => {
  const selections = createSharedViewLodSelections();
  if (previous !== undefined) selections.selectedLevels[0] = previous;
  beginSharedViewLodSelections(selections);
  for (const value of coverage) observeSharedViewLodCoverage(selections, 0, value);
  return finalizeSharedViewLodSelection(selections, 0, lod)!;
};

describe("retained shared-view LOD selection", () => {
  it("is permutation-independent, conservative, drawable, and temporally deterministic", () => {
    forEachFuzzCase({ cases: 256, seed: 0x10d5_7e2e }, ({ random }) => {
      const levelCount = random.int(1, 9);
      const thresholds: number[] = [];
      let threshold = random.number(0.4, 1);
      for (let level = 0; level < levelCount; level += 1) {
        if (level === levelCount - 1) threshold = 0;
        thresholds.push(threshold);
        threshold *= random.number(0.1, 0.75);
      }
      const drawable = Array.from({ length: levelCount }, () => random.boolean(0.75));
      drawable[random.int(0, levelCount)] = true;
      const lod = metadata(thresholds, drawable);
      const drawableIndices = drawable.flatMap((value, level) => value ? [level] : []);
      const previous = random.boolean(0.8) ? random.pick(drawableIndices) : undefined;
      const coverages = Array.from({ length: random.int(1, 9) }, () => random.float());
      const maximum = Math.max(...coverages);
      const expected = referenceDrawable(
        referenceHysteretic(maximum, thresholds, previous),
        previous,
        drawable,
      );

      expect(select(coverages, lod, previous)).toBe(expected);
      expect(select(shuffled(coverages, random), lod, previous)).toBe(expected);
      expect(drawable[expected]).toBe(true);

      const higherCoverage = Math.min(1, maximum + random.number(0.0001, 0.2));
      const allDrawable = metadata(thresholds, Array.from({ length: levelCount }, () => true));
      const monotonicPrevious = previous;
      expect(select([...coverages, higherCoverage], allDrawable, monotonicPrevious))
        .toBeLessThanOrEqual(select(coverages, allDrawable, monotonicPrevious));

      const forward = createSharedViewLodSelections();
      const reverse = createSharedViewLodSelections();
      for (let frame = 0; frame < 24; frame += 1) {
        const views = Array.from({ length: random.int(1, 5) }, () => random.float());
        beginSharedViewLodSelections(forward);
        beginSharedViewLodSelections(reverse);
        for (const value of views) observeSharedViewLodCoverage(forward, 0, value);
        for (let index = views.length - 1; index >= 0; index -= 1) {
          observeSharedViewLodCoverage(reverse, 0, views[index]!);
        }
        expect(finalizeSharedViewLodSelection(forward, 0, lod))
          .toBe(finalizeSharedViewLodSelection(reverse, 0, lod));
      }
    });
  });

  it("preserves unseen selections, rejects double finalization, and grows only explicitly", () => {
    const selections = createSharedViewLodSelections(1);
    const lod = metadata([0.2, 0], [true, true]);
    beginSharedViewLodSelections(selections);
    observeSharedViewLodCoverage(selections, 0, 0.8);
    expect(finalizeSharedViewLodSelection(selections, 0, lod)).toBe(0);
    expect(() => finalizeSharedViewLodSelection(selections, 0, lod)).toThrow(/finalized twice/);

    beginSharedViewLodSelections(selections);
    expect(sharedViewLodWasObserved(selections, 0)).toBe(false);
    expect(finalizeSharedViewLodSelection(selections, 0, lod)).toBeUndefined();
    expect(sharedViewLodSelectedLevel(selections, 0)).toBe(0);
    expect(() => observeSharedViewLodCoverage(selections, 1, 0.5)).toThrow(/reserved capacity/);

    reserveSharedViewLodSelections(selections, 4_096);
    expect(selections.capacity).toBe(4_096);
    expect(selections.selectedLevels[0]).toBe(0);
    expect(selections.selectedLevels[1]).toBe(NO_SHARED_VIEW_LOD_LEVEL);
  });

  it("rejects invalid prepared metadata before the hot path", () => {
    expect(() => metadata([0.2, 0], [false, false])).toThrow(/drawable level/);
    expect(() => metadata([0.2, 0.3], [true, true])).toThrow(/nonincreasing/);
    expect(() => metadata([Number.NaN], [true])).toThrow(/finite/);
    const lod = metadata([0.2, 0], [true, true]);
    expect(() => sharedViewHystereticLodLevel(0.5, lod, 0, Number.NaN)).toThrow(/hysteresis ratio/);
  });

  it("keeps the 4k-selection stereo hot path allocation-free after reserve", () => {
    const count = 4_096;
    const selections = createSharedViewLodSelections();
    reserveSharedViewLodSelections(selections, count);
    const lod = metadata([0.2, 0.05, 0], [true, true, true]);
    const buffers = {
      finalizationEpochs: selections.finalizationEpochs,
      maximumCoverages: selections.maximumCoverages,
      observationEpochs: selections.observationEpochs,
      selectedLevels: selections.selectedLevels,
    };
    const started = performance.now();
    for (let frame = 0; frame < 64; frame += 1) {
      beginSharedViewLodSelections(selections);
      for (let id = 0; id < count; id += 1) {
        observeSharedViewLodCoverage(selections, id, ((id + frame) & 255) / 255);
        observeSharedViewLodCoverage(selections, id, ((id * 3 + frame) & 255) / 255);
      }
      for (let id = 0; id < count; id += 1) finalizeSharedViewLodSelection(selections, id, lod);
    }
    const elapsedMs = performance.now() - started;
    expect(selections.finalizationEpochs).toBe(buffers.finalizationEpochs);
    expect(selections.maximumCoverages).toBe(buffers.maximumCoverages);
    expect(selections.observationEpochs).toBe(buffers.observationEpochs);
    expect(selections.selectedLevels).toBe(buffers.selectedLevels);
    expect(elapsedMs).toBeGreaterThan(0);
  });
});
