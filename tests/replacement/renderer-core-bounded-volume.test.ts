import {
  boundedVolume,
  boxGeometry,
  planeGeometry,
} from "@royal/renderer-core";
import { describe, expect, it } from "vitest";

describe("bounded volume descriptor", () => {
  it("resolves deterministic defaults and owns authored value tuples", () => {
    const color = [0.1, 0.8, 0.3, 0.75] as const;
    const profile = [[0, 0.2], [0.4, 1], [1, 0]] as const;
    const noiseScale = [2, 4, 6] as const;
    const transform = { position: [1, 2, 3] as const };
    const geometry = boxGeometry([2, 3, 4]);
    const volume = boundedVolume({
      color,
      densityProfile: profile,
      extinctionPerMetre: 2.5,
      geometry,
      noiseScale,
      transform,
    });

    expect(volume).toEqual({
      color: [0.1, 0.8, 0.3, 0.75],
      densityProfile: [[0, 0.2], [0.4, 1], [1, 0]],
      extinctionPerMetre: 2.5,
      geometry,
      kind: "bounded-volume",
      noiseScale: [2, 4, 6],
      noiseStrength: 0.35,
      transform: {
        position: [1, 2, 3],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    });
    expect(volume.color).not.toBe(color);
    expect(volume.densityProfile).not.toBe(profile);
    expect(volume.densityProfile[0]).not.toBe(profile[0]);
    expect(volume.noiseScale).not.toBe(noiseScale);
    expect(volume.transform).not.toBe(transform);
  });

  it("rejects non-volumetric geometry and malformed density inputs eagerly", () => {
    const options = {
      color: [0.1, 0.8, 0.3, 1] as const,
      extinctionPerMetre: 1,
      geometry: boxGeometry(1),
    };

    expect(() => boundedVolume({ ...options, geometry: planeGeometry(1) } as never))
      .toThrow(/closed box or convex triangle mesh/);
    expect(() => boundedVolume({ ...options, extinctionPerMetre: 0 })).toThrow(RangeError);
    expect(() => boundedVolume({ ...options, noiseStrength: 1.01 })).toThrow(/within 0\.\.1/);
    expect(() => boundedVolume({ ...options, noiseScale: [1, 0, 1] })).toThrow(RangeError);
    expect(() => boundedVolume({ ...options, transform: { scale: [1, 0, 1] } }))
      .toThrow(/scale must be non-zero/);
    expect(() => boundedVolume({ ...options, densityProfile: [[0, 1], [0.5, 1]] }))
      .toThrow(/end at 1/);
    expect(() => boundedVolume({ ...options, densityProfile: [[0, 1], [0.5, 1], [0.5, 0], [1, 0]] }))
      .toThrow(/strictly increasing/);
    expect(() => boundedVolume({ ...options, extra: true } as never)).toThrow(/unsupported option/);
  });
});
