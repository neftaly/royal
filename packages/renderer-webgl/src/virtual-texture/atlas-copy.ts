type AtlasImage = Readonly<{
  atlasTexture: WebGLTexture;
  atlasColumns: number;
  storedPageSize: number;
}>;

/** Copies a bounded batch of RGBA pages without readback or source decoding. */
export const copyVirtualTextureAtlasSlots = (
  gl: WebGL2RenderingContext,
  source: AtlasImage,
  target: AtlasImage,
  slots: readonly number[],
  validate = true,
): void => {
  if (slots.length === 0) return;
  const previousRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const framebuffer = gl.createFramebuffer();
  if (framebuffer === null) throw new Error("Royal VT could not create an atlas copy framebuffer");
  try {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, source.atlasTexture, 0);
    if (gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Royal VT atlas copy framebuffer is incomplete");
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target.atlasTexture);
    const size = source.storedPageSize;
    for (const slot of slots) {
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0,
        (slot % target.atlasColumns) * size, Math.floor(slot / target.atlasColumns) * size,
        (slot % source.atlasColumns) * size, Math.floor(slot / source.atlasColumns) * size,
        size, size);
    }
    if (validate && gl.getError() !== gl.NO_ERROR) throw new Error("Royal VT atlas copy failed");
  } finally {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousRead);
    gl.deleteFramebuffer(framebuffer);
  }
};
