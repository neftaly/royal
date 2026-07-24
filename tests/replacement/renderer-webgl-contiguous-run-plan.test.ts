import { describe, expect, it } from "vitest";
import {
  planContiguousRunEnds,
  planRetainedContiguousRunEnds,
} from "../../packages/renderer-webgl/src/surface/contiguous-run-plan";
import { assertFuzz, forEachFuzzCase } from "../fuzz";

describe("contiguous run planning core", () => {
  it("publishes the exclusive end for every member of each run", () => {
    expect([...planContiguousRunEnds(
      [1, 1, 2, 2, 2, 4],
      (left, right) => left === right,
    )]).toEqual([2, 2, 5, 5, 5, 6]);
    expect([...planContiguousRunEnds([], Object.is)]).toEqual([]);
  });

  it("reuses exact retained storage and replaces only topology changes", () => {
    const retained = new Uint32Array(4);
    expect(planRetainedContiguousRunEnds(
      retained,
      [1, 1, 2, 2],
      Object.is,
    )).toBe(retained);
    expect([...retained]).toEqual([2, 2, 4, 4]);
    expect(planRetainedContiguousRunEnds(
      retained,
      [1, 2],
      Object.is,
    )).not.toBe(retained);
  });

  it("fuzzes complete, maximal run coverage", () => {
    forEachFuzzCase({ cases: 256, seed: 0xc0_71_6a_05 }, ({ random }) => {
      const values = random.array(random.int(0, 257), () => random.int(0, 12));
      const ends = planContiguousRunEnds(values, Object.is);
      assertFuzz(ends.length === values.length, "run plan must cover every value");
      for (let index = 0; index < values.length; index += 1) {
        const end = ends[index]!;
        assertFuzz(end > index && end <= values.length, "run end must be forward and bounded");
        for (let member = index + 1; member < end; member += 1) {
          assertFuzz(values[member] === values[index], "members inside one run must match");
        }
        if (end < values.length) {
          assertFuzz(values[end] !== values[index], "run must stop at its first different value");
        }
      }
    });
  });
});
