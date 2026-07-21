import {
  MAX_CANONICAL_DIRECTIONAL_LIGHTS,
  MAX_CANONICAL_PUNCTUAL_LIGHTS,
  type CanonicalDirectionalLight,
  type CanonicalPunctualLight,
} from "./scene-lowering";

export type CanonicalLightUniformStorage = Readonly<{
  directionalColors: Float32Array;
  directionalDirections: Float32Array;
  punctualColors: Float32Array;
  punctualDirections: Float32Array;
  punctualPositions: Float32Array;
  punctualSpotCones: Float32Array;
}>;

/** Allocates one owner-retained uniform workspace at Royal's canonical limits. */
export const createCanonicalLightUniformStorage = (): CanonicalLightUniformStorage => ({
  directionalColors: new Float32Array(MAX_CANONICAL_DIRECTIONAL_LIGHTS * 4),
  directionalDirections: new Float32Array(MAX_CANONICAL_DIRECTIONAL_LIGHTS * 4),
  punctualColors: new Float32Array(MAX_CANONICAL_PUNCTUAL_LIGHTS * 4),
  punctualDirections: new Float32Array(MAX_CANONICAL_PUNCTUAL_LIGHTS * 4),
  punctualPositions: new Float32Array(MAX_CANONICAL_PUNCTUAL_LIGHTS * 4),
  punctualSpotCones: new Float32Array(MAX_CANONICAL_PUNCTUAL_LIGHTS * 4),
});

/** Deterministically packs canonical lights into caller-owned vec4 uniform storage. */
export const packCanonicalLightUniformsInto = (
  directionalLights: readonly CanonicalDirectionalLight[],
  punctualLights: readonly CanonicalPunctualLight[],
  output: CanonicalLightUniformStorage,
): void => {
  output.directionalColors.fill(0);
  output.directionalDirections.fill(0);
  for (let index = 0; index < directionalLights.length; index += 1) {
    const light = directionalLights[index]!;
    const offset = index * 4;
    output.directionalColors.set(light.color, offset);
    output.directionalDirections.set(light.direction, offset);
  }
  output.punctualColors.fill(0);
  output.punctualDirections.fill(0);
  output.punctualPositions.fill(0);
  output.punctualSpotCones.fill(0);
  for (let index = 0; index < punctualLights.length; index += 1) {
    const light = punctualLights[index]!;
    const offset = index * 4;
    output.punctualColors.set(light.color, offset);
    output.punctualDirections.set(light.direction, offset);
    output.punctualDirections[offset + 3] = light.kind === "spot" ? 1 : 0;
    output.punctualPositions.set(light.position, offset);
    output.punctualPositions[offset + 3] = light.range;
    output.punctualSpotCones[offset] = light.innerConeCosine;
    output.punctualSpotCones[offset + 1] = light.outerConeCosine;
  }
};
