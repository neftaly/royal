import { expect, it, vi } from "vitest";
import { IdleAstcStorage } from "../../packages/renderer-webgl/src/virtual-texture/astc/storage";
import { PersistentGpuBudgetOwner } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";
import { fakeGl } from "./support/canvas-root-harness";

it("grows through one bounded copy per step and retains both allocations until publication", () => {
  const gl = fakeGl(), budget = new PersistentGpuBudgetOwner();
  gl.compressedTexSubImage2D = vi.fn();
  const storage = new IdleAstcStorage(gl, budget, 132);
  const step = () => storage.ensureCapacity(() => true, 4096, budget.availableBytes, () => true);
  try {
    expect(step()).toBe(false); expect(step()).toBe(true);
    for (let i = 0; i < 8; i++) storage.append(new Uint8Array(7744));
    const original = storage.texture, before = budget.snapshot().retainedBytes;
    expect(step()).toBe(false);
    expect(budget.snapshot().retainedBytes).toBe(before * 3);
    for (let i = 0; i < 8; i++) {
      const copies = vi.mocked(gl.compressedTexSubImage2D).mock.calls.length;
      expect(step()).toBe(false);
      expect(vi.mocked(gl.compressedTexSubImage2D).mock.calls.length - copies).toBe(1);
      expect(storage.texture).toBe(original);
    }
    expect(step()).toBe(true);
    expect(storage.texture).not.toBe(original);
    expect(budget.snapshot().retainedBytes).toBe(before * 2);
  } finally { storage.dispose(); }
  expect(budget.snapshot().retainedBytes).toBe(0);
});

it("releases unfinished growth immediately when foreground work resumes", () => {
  const gl = fakeGl(), budget = new PersistentGpuBudgetOwner();
  gl.compressedTexSubImage2D = vi.fn();
  const storage = new IdleAstcStorage(gl, budget, 132);
  const step = () => storage.ensureCapacity(() => true, 4096, budget.availableBytes, () => true);
  try {
    step(); step();
    for (let i = 0; i < 8; i++) storage.append(new Uint8Array(7744));
    const original = storage.texture, before = budget.snapshot().retainedBytes;
    step(); step();
    storage.cancelGrowth();
    expect(storage.texture).toBe(original);
    expect(storage.blocks).toHaveLength(8);
    expect(budget.snapshot().retainedBytes).toBe(before);
  } finally { storage.dispose(); }
});

it("does not allocate when the VT pool has no migration headroom", () => {
  const gl = fakeGl(), budget = new PersistentGpuBudgetOwner();
  const storage = new IdleAstcStorage(gl, budget, 132);
  expect(() => storage.ensureCapacity(() => true, 4096, 1, () => true)).toThrow(/headroom/);
  expect(budget.snapshot().retainedBytes).toBe(0);
  expect(gl.texStorage2D).not.toHaveBeenCalled();
});
