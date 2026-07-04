import type { Rgba } from "@royal/renderer-core";
import { identityMat4, type Mat4 } from "../math/mat4";
import type { SurfaceLightSet } from "./lights";

export const IBL_SPECULAR_TEXTURE_UNIT = 2;
export const IBL_IRRADIANCE_COEFFICIENT_COUNT = 9;

export type IblBrdfLutTextureBinding = {
  readonly texture: WebGLTexture;
  readonly textureUnit: number;
};

export type SurfaceIblUniformContext = {
  readonly brdfLutTexture: () => IblBrdfLutTextureBinding | undefined;
  readonly gl: WebGL2RenderingContext;
  readonly uniform1i: (program: WebGLProgram, name: string, value: number) => void;
  readonly uniformColor: (program: WebGLProgram, name: string, color: Rgba) => void;
  readonly uniformMatrix: (program: WebGLProgram, name: string, matrix: Mat4) => void;
};

export const bindSurfaceIblUniforms = (
  context: SurfaceIblUniformContext,
  program: WebGLProgram,
  lightSet: SurfaceLightSet,
): void => {
  const irradiance = lightSet.irradiance;
  context.uniform1i(program, "u_useIblIrradiance", irradiance === undefined ? 0 : 1);
  context.uniformColor(program, "u_iblIrradianceSettings", [
    irradiance === undefined ? 0 : 1,
    irradiance?.intensity ?? 1,
    0,
    0,
  ]);
  context.uniformMatrix(program, "u_iblWorldToIbl", irradiance?.worldToIbl ?? identityMat4());
  const specular = lightSet.specular;
  context.uniform1i(program, "u_useIblSpecular", specular === undefined ? 0 : 1);
  context.uniformColor(program, "u_iblSpecularSettings", [
    specular === undefined ? 0 : 1,
    specular?.intensity ?? 1,
    specular?.mipCount ?? 1,
    specular?.encoding === "rgbd" ? 1 : 0,
  ]);
  const gl = context.gl;
  if (specular !== undefined) {
    gl.activeTexture(gl.TEXTURE0 + IBL_SPECULAR_TEXTURE_UNIT);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, specular.texture);
    context.uniform1i(program, "u_iblSpecularCube", IBL_SPECULAR_TEXTURE_UNIT);
  }
  const brdfLut = specular === undefined ? undefined : context.brdfLutTexture();
  context.uniform1i(program, "u_useIblBrdfLut", brdfLut === undefined ? 0 : 1);
  if (brdfLut !== undefined) {
    gl.activeTexture(gl.TEXTURE0 + brdfLut.textureUnit);
    gl.bindTexture(gl.TEXTURE_2D, brdfLut.texture);
    context.uniform1i(program, "u_iblBrdfLut", brdfLut.textureUnit);
  }
  for (let index = 0; index < IBL_IRRADIANCE_COEFFICIENT_COUNT; index += 1) {
    const coefficient = irradiance?.coefficients[index] ?? [0, 0, 0] as const;
    context.uniformColor(program, `u_iblIrradianceCoefficients[${index}]`, [
      coefficient[0],
      coefficient[1],
      coefficient[2],
      0,
    ]);
  }
};
