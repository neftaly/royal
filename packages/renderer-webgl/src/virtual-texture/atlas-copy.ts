type AtlasImage = {
  atlasTexture: WebGLTexture;
  atlasColumns: number;
  storedPageSize: number;
  copyFramebuffer?: WebGLFramebuffer;
};

/** Copies a bounded batch of RGBA pages without readback or source decoding. */
export const copyVirtualTextureAtlasSlots = (
  gl: WebGL2RenderingContext,
  source: AtlasImage,
  target: AtlasImage,
  slots: readonly number[],
  validate = true,
  targetSlots: readonly number[] = slots,
): void => {
  if (slots.length === 0) return;
  const previousRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const framebuffer = source.copyFramebuffer ?? gl.createFramebuffer();
  if (framebuffer === null) throw new Error("Royal VT could not create an atlas copy framebuffer");
  try {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
    if (source.copyFramebuffer === undefined) {
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, source.atlasTexture, 0);
      if (gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error("Royal VT atlas copy framebuffer is incomplete");
      }
      // The source image is immutable. Its owner releases this attachment with
      // the atlas, so subsequent batches need no allocation or completeness query.
      source.copyFramebuffer = framebuffer;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target.atlasTexture);
    const size = source.storedPageSize;
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index]!;
      const targetSlot = targetSlots[index]!;
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0,
        (targetSlot % target.atlasColumns) * size, Math.floor(targetSlot / target.atlasColumns) * size,
        (slot % source.atlasColumns) * size, Math.floor(slot / source.atlasColumns) * size,
        size, size);
    }
    if (validate && gl.getError() !== gl.NO_ERROR) throw new Error("Royal VT atlas copy failed");
  } finally {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousRead);
    if (source.copyFramebuffer === undefined) gl.deleteFramebuffer(framebuffer);
  }
};
