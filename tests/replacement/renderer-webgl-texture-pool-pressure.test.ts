import { expect, it } from "vitest";
import { PersistentGpuBudgetOwner } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";
import { allocateVirtualTextureSlots } from "../../packages/renderer-webgl/src/virtual-texture/pool-budget";

it("keeps migration scratch demand-sized and charges both copies against the hard ceiling", () => {
  const budget = new PersistentGpuBudgetOwner(1000);
  budget.setTextureBudget(900);
  budget.setTextureMigrationReserve(100);
  const old = {}, next = {};
  expect(budget.textureBudgetBytes).toBe(800);
  expect(budget.tryClaimTexture(old, 800)).toBe(true);
  expect(budget.tryClaimTexture({}, 1)).toBe(false);
  expect(budget.tryClaimTextureReplacement(next, 100, old)).toBe(true);
  expect(budget.snapshot().retainedBytes).toBe(900);
  expect(budget.tryClaimTextureReplacement({}, 101, old)).toBe(false);
  budget.release(old);
  expect(budget.textureRetainedBytes).toBe(100);
  expect(budget.textureAvailableBytes).toBe(700);
});

it("can shrink an atlas after essential targets reduce its envelope", () => {
  const budget = new PersistentGpuBudgetOwner(1000);
  budget.setTextureBudget(900);
  const old = {}, replacement = {};
  expect(budget.tryClaimTexture(old, 800)).toBe(true);
  budget.setTextureBudget(300);
  expect(budget.textureAvailableBytes).toBe(0);
  expect(budget.tryClaimTextureReplacement(replacement, 200, old)).toBe(true);
  expect(budget.snapshot().retainedBytes).toBe(1000);
  budget.release(old);
  expect(budget.tryClaim({}, 700)).toBe(true);
  expect(budget.snapshot().retainedBytes).toBe(900);
});

it("shrinks migration headroom along with the remaining texture envelope", () => {
  const budget = new PersistentGpuBudgetOwner(1000);
  budget.setTextureMigrationReserve(1000);
  budget.setTextureBudget(100);
  expect(budget.textureBudgetBytes).toBe(88);
  expect(budget.snapshot().textureMigrationReserveBytes).toBe(12);
});

it("admits deterministic whole slots when visible image count exceeds capacity", () => {
  const requests = Array.from({ length: 100 }, (_, index) => ({ key: String(index), minimumBytes: 1, wantedBytes: 8 }));
  const shares = allocateVirtualTextureSlots(requests, 13);
  expect([...shares.values()].reduce((sum, count) => sum + count, 0)).toBe(13);
  expect([...shares.values()].filter(count => count > 0)).toHaveLength(13);
  expect(Object.fromEntries(allocateVirtualTextureSlots([...requests].reverse(), 13))).toEqual(Object.fromEntries(shares));
});
