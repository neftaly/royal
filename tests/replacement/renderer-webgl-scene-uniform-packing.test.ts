import { describe, expect, it } from "vitest";
import {
  createCanonicalSceneUniformStorage,
  packCanonicalEnvironmentUniformsInto,
  packCanonicalPresentationUniformsInto,
} from "../../packages/renderer-webgl/src/surface/scene-uniform-packing";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";

describe("canonical scene uniform packing", () => {
  it("packs studio and prefiltered environment settings into retained storage", () => {
    const output = createCanonicalSceneUniformStorage();
    output.environmentSettings.fill(42);
    packCanonicalEnvironmentUniformsInto({
      radianceScaleNits: 1.5,
      rotated: false,
      rotation: identityMat4(),
      source: "studio",
    }, undefined, output);
    expect([...output.environmentSettings]).toEqual([1.5, 0, 0, 0]);

    packCanonicalEnvironmentUniformsInto({
      radianceScaleNits: 2,
      rotated: false,
      rotation: identityMat4(),
      source: "royal-prefiltered-v1",
      src: "/studio.ktx",
    }, 7, output);
    expect([...output.environmentSettings]).toEqual([2, 6, 0, 0]);
  });

  it("packs the closed presentation policy and clears unused lanes", () => {
    const output = createCanonicalSceneUniformStorage();
    output.presentation.fill(42);
    packCanonicalPresentationUniformsInto({
      exposure: 1.25,
      toneMapping: "pbr-neutral",
    }, output);
    expect([...output.presentation]).toEqual([1.25, 1, 0, 0]);

    packCanonicalPresentationUniformsInto({
      exposure: 0.5,
      toneMapping: "linear-clamp",
    }, output);
    expect([...output.presentation]).toEqual([0.5, 0, 0, 0]);
  });
});
