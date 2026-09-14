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


it("coalesces contiguous cells without crossing either atlas row or copying gaps", () => {
  for (const sourceColumns of [2, 4, 8]) for (const targetColumns of [2, 4, 8]) {
    for (const slots of [[0, 1, 2, 3, 4, 5], [1, 2, 4, 5, 9], [5, 4, 0, 1, 3]]) {
      const gl = fakeGl();
      const source = { atlasTexture: gl.createTexture()!, atlasColumns: sourceColumns, storedPageSize: 130 };
      const target = { atlasTexture: gl.createTexture()!, atlasColumns: targetColumns, storedPageSize: 130 };
      const targets = slots.map((_, index) => index + 1);
      copyVirtualTextureAtlasSlots(gl, source, target, slots, false, targets);
      const copied: number[][] = [];
      for (const call of vi.mocked(gl.copyTexSubImage2D).mock.calls) {
        const [, , dx, dy, sx, sy, width, height] = call;
        expect(height).toBe(130);
        expect(sx + width).toBeLessThanOrEqual(sourceColumns * 130);
        expect(dx + width).toBeLessThanOrEqual(targetColumns * 130);
        for (let x = 0; x < width; x += 130) copied.push([
          sy / 130 * sourceColumns + (sx + x) / 130,
          dy / 130 * targetColumns + (dx + x) / 130,
        ]);
      }
      expect(copied).toEqual(slots.map((slot, index) => [slot, targets[index]]));
    }
  }
});

it("copies a complete contiguous atlas row with one driver call", () => {
  const gl = fakeGl();
  const source = { atlasTexture: gl.createTexture()!, atlasColumns: 8, storedPageSize: 132 };
  const target = { ...source, atlasTexture: gl.createTexture()! };
  copyVirtualTextureAtlasSlots(gl, source, target, [0, 1, 2, 3, 4, 5, 6, 7]);
  expect(gl.copyTexSubImage2D).toHaveBeenCalledTimes(1);
  expect(gl.copyTexSubImage2D).toHaveBeenCalledWith(gl.TEXTURE_2D, 0, 0, 0, 0, 0, 1056, 132);
});
