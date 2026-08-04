import { describe, it } from "vitest";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import {
  CULLED_LOD_LEVEL,
  closestDrawableLodLevel,
  createDrawableLodSelectionWorkspace,
  createProjectedBoundsWorkspace,
  hystereticLodLevel,
  lodMembershipsSelected,
  maximumProjectedBoundsScreenCoverage,
  normalizeLodThresholds,
  selectDrawableLodsInto,
} from "../../packages/renderer-webgl/src/surface/lod-selection";
import {
  assertFuzz,
  assertFuzzEqual,
  forEachFuzzCase,
} from "../fuzz";

describe("canonical LOD selection properties", () => {
  it("matches a readable retained-map model across dense scene changes", () => {
    forEachFuzzCase({ cases: 32, seed: 0x4c_4f_44_03 }, ({ random }) => {
      const workspace = createDrawableLodSelectionWorkspace();
      const projection = createProjectedBoundsWorkspace();
      let previous = new Map<number, number>();
      for (let frame = 0; frame < 24; frame += 1) {
        const groupCount = random.int(0, 17);
        const groups = Array.from({ length: groupCount }, (_unused, group) => ({
          group,
          levels: [0, 1, 2],
          selectionBounds: {
            max: [0.1 + group * 0.001, 0.1, 0] as const,
            min: [-0.1 - group * 0.001, -0.1, 0] as const,
          },
          surfaceIndices: [group * 3, group * 3 + 1, group * 3 + 2],
          thresholds: [0.35, 0.04, 0],
        }));
        const resources = Array.from({ length: groupCount * 3 }, (_unused, index) => ({
          surface: { lods: [{ group: Math.floor(index / 3), level: index % 3 }] },
        }));
        const viewProjection = identityMat4();
        const scale = random.number(0.25, 8);
        viewProjection[0] = scale;
        viewProjection[5] = scale;
        const views = [{ viewProjection }];
        const expected = new Map<number, number>();
        for (const group of groups) {
          const coverage = maximumProjectedBoundsScreenCoverage(
            group.selectionBounds,
            views,
            projection,
          );
          expected.set(group.group, hystereticLodLevel(
            coverage,
            group.thresholds,
            previous.get(group.group),
          ));
        }

        const actual = selectDrawableLodsInto(groups, views, resources, workspace);
        for (let group = 0; group < Math.max(groupCount, previous.size); group += 1) {
          const expectedLevel = expected.get(group);
          assertFuzzEqual(lodMembershipsSelected(
            [{ group, level: expectedLevel ?? 0 }],
            actual,
          ), true, `frame ${frame} group ${group}`);
        }
        previous = expected;
      }
    });
  });

  it("matches drawable fallback as material presentations settle in any order", () => {
    forEachFuzzCase({ cases: 32, seed: 0x4c_4f_44_04 }, ({ random }) => {
      const workspace = createDrawableLodSelectionWorkspace();
      const projection = createProjectedBoundsWorkspace();
      let previous = new Map<number, number>();
      for (let frame = 0; frame < 24; frame += 1) {
        const groupCount = random.int(1, 17);
        const groups = Array.from({ length: groupCount }, (_unused, group) => ({
          group,
          levels: [0, 1, 2],
          selectionBounds: {
            max: [0.1 + group * 0.001, 0.1, 0] as const,
            min: [-0.1 - group * 0.001, -0.1, 0] as const,
          },
          surfaceIndices: [group * 3, group * 3 + 1, group * 3 + 2],
          thresholds: [0.35, 0.04, 0],
        }));
        const drawable = Array.from({ length: groupCount }, () => {
          const levels = new Uint8Array(3);
          for (let level = 0; level < levels.length; level += 1) {
            levels[level] = random.boolean() ? 1 : 0;
          }
          levels[random.int(0, levels.length)] = 1;
          return levels;
        });
        const resources = Array.from({ length: groupCount * 3 }, (_unused, index) => ({
          lodDrawable: drawable[Math.floor(index / 3)]![index % 3] === 1,
          surface: { lods: [{ group: Math.floor(index / 3), level: index % 3 }] },
        }));
        const viewProjection = identityMat4();
        const scale = random.number(0.25, 8);
        viewProjection[0] = scale;
        viewProjection[5] = scale;
        const views = [{ viewProjection }];
        const expected = new Map<number, number>();
        for (const group of groups) {
          const target = hystereticLodLevel(
            maximumProjectedBoundsScreenCoverage(
              group.selectionBounds,
              views,
              projection,
            ),
            group.thresholds,
            previous.get(group.group),
          );
          expected.set(group.group, closestDrawableLodLevel(
            target,
            previous.get(group.group),
            drawable[group.group]!,
          ));
        }

        const actual = selectDrawableLodsInto(groups, views, resources, workspace);
        for (const [group, level] of expected) {
          assertFuzzEqual(actual[group], level, `frame ${frame} group ${group}`);
        }
        previous = expected;
      }
    });
  });

  it("normalizes arbitrary hints into a finite descending threshold contract", () => {
    forEachFuzzCase({ cases: 48, seed: 0x4c_4f_44_01 }, ({ random }) => {
      const levelCount = random.int(1, 33);
      const hints = random.array(random.int(0, levelCount + 3), () => random.pick<unknown>([
        undefined,
        null,
        "0.5",
        Number.NaN,
        Number.NEGATIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        random.number(-2, 3),
      ]));
      const thresholds = normalizeLodThresholds(hints, levelCount);
      assertFuzzEqual(thresholds.length, levelCount, "threshold count");
      let previous = 1;
      for (const threshold of thresholds) {
        assertFuzz(Number.isFinite(threshold), "threshold must be finite");
        assertFuzz(threshold >= 0 && threshold <= 1, "threshold escaped normalized range");
        assertFuzz(threshold <= previous, "thresholds must descend");
        previous = threshold;
      }
    });
  });

  it("keeps hysteresis and drawable fallback inside the authored level set", () => {
    forEachFuzzCase({ cases: 64, seed: 0x4c_4f_44_02 }, ({ random }) => {
      const levelCount = random.int(1, 33);
      const thresholds = normalizeLodThresholds(
        random.array(levelCount, () => random.number(0, 1.01)),
        levelCount,
      );
      const coverage = random.number(0, 1);
      const hysteresisRatio = random.number(0, 1);
      const previous = random.boolean()
        ? undefined
        : random.int(CULLED_LOD_LEVEL, levelCount);
      const selected = hystereticLodLevel(
        coverage,
        thresholds,
        previous,
        hysteresisRatio,
      );
      assertFuzz(
        selected === CULLED_LOD_LEVEL || (selected >= 0 && selected < levelCount),
        "hysteresis selected an invalid level",
      );
      assertFuzzEqual(
        hystereticLodLevel(coverage, thresholds, selected, hysteresisRatio),
        selected,
        "settled hysteresis must be idempotent",
      );

      const drawable = new Uint8Array(levelCount);
      for (let level = 0; level < levelCount; level += 1) {
        drawable[level] = random.boolean() ? 1 : 0;
      }
      drawable[random.int(0, levelCount)] = 1;
      const target = random.int(0, levelCount);
      const drawablePrevious = random.boolean() ? undefined : random.int(0, levelCount);
      const fallback = closestDrawableLodLevel(
        target,
        drawablePrevious,
        drawable,
      );
      assertFuzz(fallback >= 0 && fallback < levelCount, "fallback escaped level set");
      assertFuzz(drawable[fallback] === 1, "fallback selected an unavailable level");
      if (drawable[target] === 1) {
        assertFuzzEqual(fallback, target, "drawable target must win");
      } else if (drawablePrevious !== undefined && drawable[drawablePrevious] === 1) {
        assertFuzzEqual(fallback, drawablePrevious, "drawable previous level must win");
      } else {
        let best = -1;
        let distance = Infinity;
        for (let level = 0; level < levelCount; level += 1) {
          if (drawable[level] === 0) continue;
          const candidateDistance = Math.abs(level - target);
          if (candidateDistance < distance) {
            best = level;
            distance = candidateDistance;
          }
        }
        assertFuzzEqual(fallback, best, "fallback must choose the closest drawable level");
      }
    });
  });
});
