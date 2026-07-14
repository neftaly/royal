/** Texture unit reserved transiently while CPU/image data is uploaded. */
export const TEXTURE_UPLOAD_UNIT = 0;

/** Establishes the fixed state Royal requires before clearing and drawing. */
export const prepareFrameBaseline = (
  gl: WebGL2RenderingContext,
  scissor: boolean,
): void => {
  gl.colorMask(true, true, true, true);
  gl.depthMask(true);
  gl.depthRange(0, 1);
  gl.clearDepth(1);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.BLEND);
  gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.STENCIL_TEST);
  gl.disable(gl.RASTERIZER_DISCARD);
  gl.disable(gl.POLYGON_OFFSET_FILL);
  gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
  gl.disable(gl.SAMPLE_COVERAGE);
  if (scissor) gl.enable(gl.SCISSOR_TEST);
  else gl.disable(gl.SCISSOR_TEST);
};

/** Makes texture upload meaning independent of prior pass state. */
export const prepareTextureUpload = (
  gl: WebGL2RenderingContext,
): void => {
  gl.activeTexture(gl.TEXTURE0 + TEXTURE_UPLOAD_UNIT);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, 0);
  gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
  gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, 0);
};
