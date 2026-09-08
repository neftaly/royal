import { expect, it, vi } from "vitest";
import { copyVirtualTextureAtlasSlots } from "../../packages/renderer-webgl/src/virtual-texture/atlas-copy";
import { fakeGl } from "./support/canvas-root-harness";

it("reuses a validated source attachment across copy batches and restores the read framebuffer", () => {
  const gl = fakeGl();
  const previous = gl.createFramebuffer();
  vi.mocked(gl.getParameter).mockReturnValue(previous);
  const source = { atlasTexture: gl.createTexture()!, atlasColumns: 4, storedPageSize: 130 };
  const target = { atlasTexture: gl.createTexture()!, atlasColumns: 2, storedPageSize: 130 };
  const allocations = vi.mocked(gl.createFramebuffer).mock.calls.length;
  copyVirtualTextureAtlasSlots(gl, source, target, [0, 5], false, [0, 1]);
  copyVirtualTextureAtlasSlots(gl, source, target, [8], false, [2]);
  expect(gl.createFramebuffer).toHaveBeenCalledTimes(allocations + 1);
  expect(gl.framebufferTexture2D).toHaveBeenCalledTimes(1);
  expect(gl.checkFramebufferStatus).toHaveBeenCalledTimes(1);
  expect(gl.copyTexSubImage2D).toHaveBeenLastCalledWith(gl.TEXTURE_2D, 0, 0, 130, 0, 260, 130, 130);
  expect(gl.bindFramebuffer).toHaveBeenLastCalledWith(gl.READ_FRAMEBUFFER, previous);
  expect(gl.getError).not.toHaveBeenCalled();
  expect(gl.deleteFramebuffer).not.toHaveBeenCalled();
});

it("releases an incomplete attachment and retries with a new framebuffer", () => {
  const gl = fakeGl();
  const source = { atlasTexture: gl.createTexture()!, atlasColumns: 4, storedPageSize: 130 };
  vi.mocked(gl.checkFramebufferStatus).mockReturnValueOnce(0);
  expect(() => copyVirtualTextureAtlasSlots(gl, source, source, [0])).toThrow("incomplete");
  expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(1);
  const target = { ...source, atlasTexture: gl.createTexture()! };
  copyVirtualTextureAtlasSlots(gl, source, target, [0]);
  expect(gl.createFramebuffer).toHaveBeenCalledTimes(2);
  expect(gl.checkFramebufferStatus).toHaveBeenCalledTimes(2);
});
