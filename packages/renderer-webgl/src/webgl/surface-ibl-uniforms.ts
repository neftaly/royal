import { identityMat4 } from "../math/mat4";
import type { SurfaceLightSet } from "./lights";
import {
  uniform1i,
  uniform4f,
  uniformMatrix,
  type ProgramArena,
} from "./program-arena";

const IBL_IRRADIANCE_COEFFICIENT_UNIFORMS = Array.from(
  { length: 9 },
  (_, index) => `u_iblIrradianceCoefficients[${index}]`,
);
const IDENTITY_IBL_MATRIX = identityMat4();
const ZERO_IRRADIANCE_COEFFICIENT = [0, 0, 0] as const;

/** Binds diffuse IBL without requiring the optional specular GPU runtime. */
export const bindSurfaceIblIrradiance = (
  programArena: ProgramArena,
  program: WebGLProgram,
  lightSet: SurfaceLightSet,
): void => {
  const irradiance = lightSet.irradiance;
  uniform4f(programArena, program, "u_iblIrradianceSettings",
    irradiance === undefined ? 0 : 1, irradiance?.intensity ?? 1, 0, 0);
  uniformMatrix(programArena, program, "u_iblWorldToIbl", irradiance?.worldToIbl ?? IDENTITY_IBL_MATRIX);
  for (let index = 0; index < IBL_IRRADIANCE_COEFFICIENT_UNIFORMS.length; index += 1) {
    const coefficient = irradiance?.coefficients[index] ?? ZERO_IRRADIANCE_COEFFICIENT;
    uniform4f(programArena, program, IBL_IRRADIANCE_COEFFICIENT_UNIFORMS[index]!,
      coefficient[0], coefficient[1], coefficient[2], 0);
  }
};

export const bindSurfaceIblFallback = (
  programArena: ProgramArena,
  program: WebGLProgram,
  lightSet: SurfaceLightSet,
  bindIrradiance = true,
): void => {
  if (bindIrradiance) bindSurfaceIblIrradiance(programArena, program, lightSet);
  uniform1i(programArena, program, "u_useIblSpecular", 0);
  uniform4f(programArena, program, "u_iblSpecularSettings",
    0, lightSet.specular?.intensity ?? 1, lightSet.specular?.mipCount ?? 1,
    lightSet.specular?.encoding === "rgbd" ? 1 : 0);
  uniform1i(programArena, program, "u_useIblBrdfLut", 0);
};
