import { expect, it } from "vitest";
import { allocateVirtualTexturePoolBytes } from "../../packages/renderer-webgl/src/virtual-texture/pool-budget";

it("reserves coarse coverage and distributes excess independent of insertion order", () => {
  const requests = [
    { key: "small", minimumBytes: 10, wantedBytes: 20 },
    { key: "a", minimumBytes: 10, wantedBytes: 100 },
    { key: "b", minimumBytes: 20, wantedBytes: 100 },
  ];
  const result = allocateVirtualTexturePoolBytes(requests, 100);
  expect(Object.fromEntries(result)).toEqual({ small: 20, a: 35, b: 45 });
  expect(Object.fromEntries(allocateVirtualTexturePoolBytes([...requests].reverse(), 100)))
    .toEqual(Object.fromEntries(result));
});

it("does not allocate beyond demand or overcommit an insufficient coverage budget", () => {
  const requests = [{ key: "a", minimumBytes: 40, wantedBytes: 100 }, { key: "b", minimumBytes: 20, wantedBytes: 80 }];
  expect(Object.fromEntries(allocateVirtualTexturePoolBytes(requests, 30))).toEqual({ a: 20, b: 10 });
  expect(Object.fromEntries(allocateVirtualTexturePoolBytes(requests, 500))).toEqual({ a: 100, b: 80 });
  expect(allocateVirtualTexturePoolBytes([], 500).size).toBe(0);
});


it("keeps integer allocations within the ceiling across uneven pool counts", () => {
  for (const count of [1, 3, 7, 31, 60]) {
    const requests = Array.from({ length: count }, (_, index) => ({
      key: String(index), minimumBytes: (index + 1) * 13, wantedBytes: (index + 1) * 104729,
    }));
    for (const budget of [0, 1, 101, 100003, 201326592]) {
      const result = allocateVirtualTexturePoolBytes(requests, budget);
      expect([...result.values()].reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(budget);
      for (const request of requests) {
        const bytes = result.get(request.key)!;
        expect(Number.isSafeInteger(bytes)).toBe(true);
        expect(bytes).toBeGreaterThanOrEqual(0);
        expect(bytes).toBeLessThanOrEqual(request.wantedBytes);
      }
    }
  }
});
