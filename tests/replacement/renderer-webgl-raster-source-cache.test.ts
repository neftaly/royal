import { expect, it, vi } from "vitest";
import { imageTexture } from "@royal/renderer-core";
import { RasterSourceCache } from "../../packages/renderer-webgl/src/virtual-texture/raster-source-cache";
import { PersistentGpuBudgetOwner } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";

const asset = (id: number) => imageTexture(`https://example.test/${id}.png`);
const signal = () => new AbortController().signal;
const raster = () => ({ width: 4, height: 4, source: {} as ImageBitmap, close: vi.fn() });

it("pages a catalog ten times larger than the CPU cache without retaining source leases", async () => {
  const sources: ReturnType<typeof raster>[] = [];
  const decode = vi.fn(async () => { const source = raster(); sources.push(source); return source; });
  const cache = new RasterSourceCache(decode, 128, 64);
  for (let i = 0; i < 20; i++) {
    await cache.read(asset(i), signal(), source => expect(source.width).toBe(4));
    expect(cache.snapshot.bytes).toBeLessThanOrEqual(128);
  }
  expect(sources.filter(source => source.close.mock.calls.length === 0)).toHaveLength(2);
  await cache.read(asset(19), signal(), () => undefined);
  expect(decode).toHaveBeenCalledTimes(20);
  await cache.read(asset(0), signal(), () => undefined);
  expect(decode).toHaveBeenCalledTimes(21);
  cache.dispose();
  for (const source of sources) expect(source.close).toHaveBeenCalledOnce();
  expect(cache.snapshot.bytes).toBe(0);
});

it("serializes concurrent misses and abandons queued reads after disposal", async () => {
  let release!: (value: ReturnType<typeof raster>) => void;
  const decode = vi.fn(() => new Promise<ReturnType<typeof raster>>(resolve => { release = resolve; }));
  const cache = new RasterSourceCache(decode, 128, 64);
  const first = cache.read(asset(0), signal(), () => undefined);
  const second = cache.read(asset(1), signal(), () => undefined);
  const settled = Promise.allSettled([first, second]);
  await Promise.resolve();
  expect(decode).toHaveBeenCalledOnce();
  expect(cache.seed(asset(0), raster(), vi.fn())).toBe(false);
  cache.dispose();
  const source = raster();
  release(source);
  expect((await settled).map(result => result.status)).toEqual(["rejected", "rejected"]);
  expect(source.close).toHaveBeenCalledOnce();
  expect(decode).toHaveBeenCalledOnce();
});

it("rejects and closes an oversized decode without poisoning subsequent reads", async () => {
  const oversized = { ...raster(), width: 8 };
  const cache = new RasterSourceCache(vi.fn().mockResolvedValueOnce(oversized).mockResolvedValue(raster()), 128, 64);
  await expect(cache.read(asset(0), signal(), () => undefined)).rejects.toThrow("reservation");
  expect(oversized.close).toHaveBeenCalledOnce();
  await cache.read(asset(1), signal(), () => undefined);
  expect(cache.snapshot.bytes).toBe(64);
  cache.dispose();
});

it("shares a flexible texture envelope while preserving essential allocations and retry capacity", () => {
  const budget = new PersistentGpuBudgetOwner(1000);
  budget.setTextureBudget(900);
  const ordinary = {}, vt = {}, target = {};
  expect(budget.tryClaimTexture(ordinary, 100)).toBe(true);
  expect(budget.tryClaimTexture(vt, 800)).toBe(true);
  expect(budget.tryClaim(target, 100)).toBe(true);
  expect(budget.tryClaimTexture(vt, 801)).toBe(false);
  budget.setTextureBudget(600);
  expect(budget.tryClaimTexture(vt, 500)).toBe(true);
  budget.release(target);
  expect(budget.tryClaim(target, 400)).toBe(true);
  budget.release(ordinary);
  expect(budget.textureAvailableBytes).toBe(100);
  expect(budget.tryClaimTexture(vt, 600)).toBe(true);
  budget.release(vt);
  expect(budget.textureRetainedBytes).toBe(0);
});

it("accounts for generic claims converted to texture storage", () => {
  const budget = new PersistentGpuBudgetOwner(1000), claim = {};
  budget.tryClaim(claim, 100);
  expect(budget.tryClaimTexture(claim, 200)).toBe(true);
  expect(budget.textureRetainedBytes).toBe(200);
  budget.release(claim);
  expect(budget.textureRetainedBytes).toBe(0);
});

it("decodes coarse requests cheaply and upgrades only when a finer request arrives", async () => {
  const coarse = { ...raster(), width: 2, height: 2 }, fine = raster();
  const decode = vi.fn().mockResolvedValueOnce(coarse).mockResolvedValueOnce(fine);
  const cache = new RasterSourceCache(decode, 128, 64);
  await cache.read(asset(0), signal(), source => expect(source.width).toBe(2), 16);
  expect(decode.mock.calls[0]?.[2]).toBe(16);
  await cache.read(asset(0), signal(), () => undefined, 16);
  expect(decode).toHaveBeenCalledOnce();
  await cache.read(asset(0), signal(), source => expect(source.width).toBe(4), 64);
  expect(coarse.close).toHaveBeenCalledOnce();
  expect(decode.mock.calls[1]?.[2]).toBe(64);
  await cache.read(asset(0), signal(), source => expect(source.width).toBe(4), 16);
  expect(decode).toHaveBeenCalledTimes(2);
  cache.dispose();
  expect(fine.close).toHaveBeenCalledOnce();
});

it("reuses initial decode leases without pinning the entire artwork catalog", async () => {
  const load = vi.fn(async () => raster()), cache = new RasterSourceCache(load, 128, 64);
  const releases = Array.from({ length: 20 }, () => vi.fn());
  for (let i = 0; i < 20; i++) expect(cache.seed(asset(i), raster(), releases[i]!)).toBe(true);
  expect(releases.filter(release => release.mock.calls.length === 0)).toHaveLength(2);
  await cache.read(asset(19), signal(), () => undefined);
  expect(load).not.toHaveBeenCalled();
  cache.dispose();
  for (const release of releases) expect(release).toHaveBeenCalledOnce();
});

it("keeps warm pixels when a small miss fits without evicting a maximum-sized reservation", async () => {
  const load = vi.fn(async () => ({ ...raster(), width: 1, height: 1 }));
  const cache = new RasterSourceCache(load, 128, 64);
  const release = vi.fn();
  cache.seed(asset(0), raster(), release);
  await cache.read(asset(1), signal(), () => undefined, 4);
  await cache.read(asset(2), signal(), () => undefined, 4);
  await cache.read(asset(0), signal(), () => undefined, 64);
  expect(release).not.toHaveBeenCalled();
  expect(load).toHaveBeenCalledTimes(2);
  expect(cache.snapshot.bytes).toBe(72);
  cache.dispose();
});

it("rejects a decoder that exceeds the specific reservation, even below the source ceiling", async () => {
  const decoded = raster();
  const cache = new RasterSourceCache(async () => decoded, 128, 64);
  await expect(cache.read(asset(0), signal(), () => undefined, 4)).rejects.toThrow("reservation");
  expect(decoded.close).toHaveBeenCalledOnce();
  expect(cache.snapshot.bytes).toBe(0);
  cache.dispose();
});

it("does not bypass texture admission by converting an unchanged generic claim", () => {
  const budget = new PersistentGpuBudgetOwner(1000), claim = {};
  budget.setTextureBudget(100);
  expect(budget.tryClaim(claim, 200)).toBe(true);
  expect(budget.tryClaimTexture(claim, 200)).toBe(false);
  expect(budget.textureRetainedBytes).toBe(0);
  expect(budget.snapshot().retainedBytes).toBe(200);
  budget.release(claim);
  expect(budget.snapshot().retainedBytes).toBe(0);
});

it("discards browser pixels and rejects old queued work across context recovery", async () => {
  const load = vi.fn(async () => raster());
  const cache = new RasterSourceCache(load, 128, 64);
  const release = vi.fn();
  cache.seed(asset(0), raster(), release);
  const stale = cache.read(asset(0), signal(), () => undefined);
  cache.invalidate();
  await expect(stale).rejects.toThrow("aborted");
  expect(release).toHaveBeenCalledOnce();
  await cache.read(asset(0), signal(), () => undefined);
  expect(load).toHaveBeenCalledOnce();
  cache.dispose();
});

it("decodes known detail on a coarse miss and reuses it for subsequent detail", async () => {
  const load = vi.fn(async () => raster());
  const cache = new RasterSourceCache(load, 128, 64);
  await cache.read(asset(0), signal(), () => undefined, 4, 64);
  expect(load).toHaveBeenCalledWith(asset(0), expect.any(AbortSignal), 64);
  await cache.read(asset(0), signal(), () => undefined, 64);
  expect(load).toHaveBeenCalledOnce();
  expect(cache.snapshot.peakBytes).toBeLessThanOrEqual(128);
  cache.dispose();
});

it("uses an already cached preview without decoding detail prematurely", async () => {
  const load = vi.fn(async () => raster());
  const cache = new RasterSourceCache(load, 128, 64);
  const preview = { ...raster(), width: 1, height: 1 }, release = vi.fn();
  expect(cache.seed(asset(0), preview, release)).toBe(true);
  await cache.read(asset(0), signal(), source => expect(source.source).toBe(preview.source), 4, 64);
  expect(load).not.toHaveBeenCalled();
  await cache.read(asset(0), signal(), () => undefined, 64);
  expect(load).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledOnce();
  cache.dispose();
});
