import { prepareTextureUpload } from "./imperative-state";
import { decodeIblBrdfLutRg8 } from "./ibl-brdf-lut-data";

const IBL_BRDF_LUT_SIZE = 64;
export const IBL_BRDF_LUT_BYTES = IBL_BRDF_LUT_SIZE * IBL_BRDF_LUT_SIZE * 2;
export const IBL_BRDF_LUT_PREFERRED_TEXTURE_UNIT = 15;

export const uploadIblBrdfLutTexture = (
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
): void => {
  const data = decodeIblBrdfLutRg8();

  prepareTextureUpload(gl);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RG8,
    IBL_BRDF_LUT_SIZE,
    IBL_BRDF_LUT_SIZE,
    0,
    gl.RG,
    gl.UNSIGNED_BYTE,
    data,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
};
