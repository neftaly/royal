import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IdleAstcEncoder } from "../../packages/renderer-webgl/src/virtual-texture/astc/encoder";
import { PoolWorker } from "./support/pool-worker";
import { waitFor } from "./support/wait-for";
beforeEach(() => { PoolWorker.instances = []; PoolWorker.execute = undefined; vi.stubGlobal("Worker", PoolWorker); });
afterEach(() => vi.unstubAllGlobals());
const setup = () => {
  const encoder = new IdleAstcEncoder(vi.fn());
  const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
  return { encoder, bitmap, worker: PoolWorker.instances[0]! };
};
it("closes an untransferred bitmap when startup transport fails", async () => {
  const { encoder, bitmap, worker } = setup();
  worker.fail = "start";
  try {
    await expect(encoder.start(bitmap, 132)).resolves.toBeUndefined();
    expect(bitmap.close).toHaveBeenCalled();
    expect(encoder.failed).toBe(true);
  } finally { encoder.dispose(); }
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(PoolWorker.instances.every(instance => instance.terminate.mock.calls.length === 1)).toBe(true);
});
it("allows exactly one outstanding row and reuses the codec worker", async () => {
  const { encoder, bitmap, worker } = setup();
  try {
    const result = encoder.start(bitmap, 132);
    encoder.grant();
    await waitFor(() => expect(worker.requests).toHaveLength(1));
    worker.reply(worker.requests[0]!);
    encoder.grant(); encoder.grant();
    expect(worker.requests).toHaveLength(2);
    worker.reply(worker.requests[1]!);
    encoder.grant();
    const blocks = new Uint8Array(16);
    worker.reply(worker.requests[2]!, blocks);
    await expect(result).resolves.toBe(blocks);
    const next = encoder.start(bitmap, 132);
    expect(PoolWorker.instances).toHaveLength(1);
    encoder.cancel();
    await expect(next).resolves.toBeUndefined();
  } finally { encoder.dispose(); }
});
it.each(["step", "error", "messageerror"])("settles outstanding work after %s failure", async failure => {
  const { encoder, bitmap, worker } = setup();
  const pending = encoder.start(bitmap, 132);
  await waitFor(() => expect(worker.requests).toHaveLength(1));
  try {
    if (failure === "step") {
      worker.reply(worker.requests[0]!);
      worker.fail = "step";
      encoder.grant();
    } else worker.dispatchEvent(new MessageEvent(failure, { data: new Error("worker failed") }));
    await expect(pending).resolves.toBeUndefined();
    expect(encoder.failed).toBe(true);
  } finally { encoder.dispose(); }
});
it("cancels hung startup, ignores stale results and permits a replacement", async () => {
  const { encoder, bitmap, worker } = setup();
  const pending = encoder.start(bitmap, 132);
  await waitFor(() => expect(worker.requests).toHaveLength(1));
  encoder.cancel();
  await expect(pending).resolves.toBeUndefined();
  const next = encoder.start(bitmap, 132);
  worker.reply(worker.requests[0]!);
  expect(encoder.failed).toBe(false);
  encoder.dispose();
  await expect(next).resolves.toBeUndefined();
});
it("makes disposal terminal and idempotent", async () => {
  const { encoder, bitmap, worker } = setup();
  const pending = encoder.start(bitmap, 132);
  encoder.dispose(); encoder.dispose();
  await expect(pending).resolves.toBeUndefined();
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(PoolWorker.instances.every(instance => instance.terminate.mock.calls.length === 1)).toBe(true);
  const later = { close: vi.fn() } as unknown as ImageBitmap;
  await expect(encoder.start(later, 132)).resolves.toBeUndefined();
  expect(later.close).toHaveBeenCalledOnce();
});
