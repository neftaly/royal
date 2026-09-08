/** Run in the Royal Vite page; checks relocation, alpha and sRGB byte preservation. */
export const runAtlasCopyProbe = async () => {
  const { copyVirtualTextureAtlasSlots } = await import("../../packages/renderer-webgl/src/virtual-texture/atlas-copy.ts");
  const gl = document.createElement("canvas").getContext("webgl2");
  if (!gl) throw new Error("WebGL2 unavailable");
  const results = [];
  for (const format of [gl.RGBA8, gl.SRGB8_ALPHA8]) {
    const data = Uint8Array.from({ length: 8 * 8 * 4 }, (_, i) => (i * 37 + 17) % 256);
    const source = gl.createTexture();
    const target = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    try {
      gl.bindTexture(gl.TEXTURE_2D, source);
      gl.texStorage2D(gl.TEXTURE_2D, 1, format, 8, 8);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.bindTexture(gl.TEXTURE_2D, target);
      gl.texStorage2D(gl.TEXTURE_2D, 1, format, 16, 8);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
      copyVirtualTextureAtlasSlots(gl,
        { atlasTexture: source, atlasColumns: 2, storedPageSize: 4 },
        { atlasTexture: target, atlasColumns: 4, storedPageSize: 4 }, [0, 1, 2, 3]);
      const restored = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) === framebuffer;
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
      const actual = new Uint8Array(16 * 8 * 4);
      gl.readPixels(0, 0, 16, 8, gl.RGBA, gl.UNSIGNED_BYTE, actual);
      let errors = 0;
      for (let slot = 0; slot < 4; slot++) for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) for (let c = 0; c < 4; c++) {
          const src = ((Math.floor(slot / 2) * 4 + y) * 8 + (slot % 2) * 4 + x) * 4 + c;
          const dst = (y * 16 + slot * 4 + x) * 4 + c;
          if (data[src] !== actual[dst]) errors++;
        }
      }
      results.push({ format, errors, restored, glError: gl.getError() });
    } finally {
      gl.deleteTexture(source);
      gl.deleteTexture(target);
      gl.deleteFramebuffer(framebuffer);
    }
  }
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return results;
};
