import { describe, expect, it } from "vitest";
import {
  createCanonicalLightUniformStorage,
  packCanonicalLightUniformsInto,
} from "../../packages/renderer-webgl/src/surface/light-uniform-packing";

describe("canonical light uniform packing", () => {
  it("packs vec4 lanes and clears every unused retained value", () => {
    const output = createCanonicalLightUniformStorage();
    packCanonicalLightUniformsInto(
      [{ color: [1, 0.5, 0.25, 1], direction: [0, -1, 0] }],
      [
        {
          color: [0.5, 1, 0.25, 1],
          direction: [0, 0, 0],
          innerConeCosine: 0,
          kind: "point",
          outerConeCosine: 0,
          position: [1, 2, 3],
          range: 4,
        },
        {
          color: [0.25, 0.5, 1, 1],
          direction: [0, 0, -1],
          innerConeCosine: 0.75,
          kind: "spot",
          outerConeCosine: 0.5,
          position: [-1, -2, -3],
          range: 8,
        },
      ],
      output,
    );

    expect([...output.directionalColors.slice(0, 8)]).toEqual([
      1, 0.5, 0.25, 1,
      0, 0, 0, 0,
    ]);
    expect([...output.directionalDirections.slice(0, 8)]).toEqual([
      0, -1, 0, 0,
      0, 0, 0, 0,
    ]);
    expect([...output.punctualColors.slice(0, 8)]).toEqual([
      0.5, 1, 0.25, 1,
      0.25, 0.5, 1, 1,
    ]);
    expect([...output.punctualDirections.slice(0, 8)]).toEqual([
      0, 0, 0, 0,
      0, 0, -1, 1,
    ]);
    expect([...output.punctualPositions.slice(0, 8)]).toEqual([
      1, 2, 3, 4,
      -1, -2, -3, 8,
    ]);
    expect([...output.punctualSpotCones.slice(0, 8)]).toEqual([
      0, 0, 0, 0,
      0.75, 0.5, 0, 0,
    ]);

    packCanonicalLightUniformsInto([], [], output);
    for (const values of Object.values(output)) {
      expect(values.every((value) => value === 0)).toBe(true);
    }
  });
});
