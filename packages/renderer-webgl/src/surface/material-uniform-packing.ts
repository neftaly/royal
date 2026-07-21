import {
  dielectricF0FromIndexOfRefraction,
  type CanonicalSurfaceMaterial,
} from "./canonical-material";

type StandardMaterial = Extract<CanonicalSurfaceMaterial, { kind: "standard" }>;

export type CanonicalMaterialUniformStorage = Readonly<{
  attenuation: Float32Array;
  emissiveAndF0: Float32Array;
  materialFactors: Float32Array;
  specularFactors: Float32Array;
  transmissionFactors: Float32Array;
}>;

/** Allocates one owner-retained workspace for canonical material vec4 uniforms. */
export const createCanonicalMaterialUniformStorage = (): CanonicalMaterialUniformStorage => ({
  attenuation: new Float32Array(4),
  emissiveAndF0: new Float32Array(4),
  materialFactors: new Float32Array(4),
  specularFactors: new Float32Array(4),
  transmissionFactors: new Float32Array(4),
});

export const packCanonicalBaseMaterialUniformsInto = (
  material: StandardMaterial,
  alphaMasked: boolean,
  emissiveTexturePresent: boolean,
  output: CanonicalMaterialUniformStorage,
): void => {
  if (material.emissiveAsset !== undefined && !emissiveTexturePresent) {
    output.emissiveAndF0.fill(0, 0, 3);
  } else output.emissiveAndF0.set(material.emissiveFactor, 0);
  output.emissiveAndF0[3] = material.indexOfRefraction === undefined
    ? 0.04
    : dielectricF0FromIndexOfRefraction(material.indexOfRefraction);
  output.materialFactors[0] = material.metallicFactor;
  output.materialFactors[1] = material.roughnessFactor;
  output.materialFactors[2] = alphaMasked ? material.alphaCutoff ?? 0.5 : 0;
  output.materialFactors[3] = material.normalScale;
};

export const packCanonicalSpecularUniformsInto = (
  material: StandardMaterial,
  output: CanonicalMaterialUniformStorage,
): void => {
  const color = material.specularColorFactor;
  output.specularFactors[0] = color?.[0] ?? 1;
  output.specularFactors[1] = color?.[1] ?? 1;
  output.specularFactors[2] = color?.[2] ?? 1;
  output.specularFactors[3] = material.specularFactor ?? 1;
};

export const packCanonicalTransmissionUniformsInto = (
  material: StandardMaterial,
  sceneColorMaxLod: number,
  output: CanonicalMaterialUniformStorage,
): void => {
  output.transmissionFactors[0] = material.transmissionFactor ?? 0;
  output.transmissionFactors[1] = material.thicknessFactor ?? 0;
  output.transmissionFactors[2] = material.indexOfRefraction ?? 1.5;
  output.transmissionFactors[3] = sceneColorMaxLod;
};

export const packCanonicalAttenuationUniformsInto = (
  material: StandardMaterial,
  output: CanonicalMaterialUniformStorage,
): void => {
  const attenuation = material.attenuationColor;
  output.attenuation[0] = attenuation?.[0] ?? 1;
  output.attenuation[1] = attenuation?.[1] ?? 1;
  output.attenuation[2] = attenuation?.[2] ?? 1;
  output.attenuation[3] = material.attenuationDistance === undefined
    ? 0
    : 1 / material.attenuationDistance;
};
