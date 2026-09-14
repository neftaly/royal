import { afterEach, expect, it, vi } from "vitest";
import { IdleAstcEncoder } from "../../packages/renderer-webgl/src/virtual-texture/astc/encoder";

class WorkerStub {
  static latest: WorkerStub;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  fail = "";
  postMessage = vi.fn((data: { type: string }) => { if (data.type === this.fail) throw new Error("Worker transport failed"); });
  terminate = vi.fn();
  constructor() { WorkerStub.latest = this; }
}
afterEach(() => vi.unstubAllGlobals());
const setup = () => {
  vi.stubGlobal("Worker", WorkerStub);
  const encoder = new IdleAstcEncoder(vi.fn());
  const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
  return { encoder, bitmap, worker: WorkerStub.latest };
};

it("closes an untransferred bitmap and clears the job when transfer fails", async () => {
  const { encoder, bitmap, worker } = setup();
  worker.fail = "start";
  try {
    await expect(encoder.start(bitmap, 132)).resolves.toBeUndefined();
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(encoder.failed).toBe(true);
  } finally { encoder.dispose(); }
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it.each(["cancel", "step", "messageerror"])("settles the outstanding job after %s transport failure", async failure => {
  const { encoder, bitmap, worker } = setup();
  const pending = encoder.start(bitmap, 132);
  worker.fail = failure;
  try {
    if (failure === "cancel") encoder.cancel();
    else if (failure === "messageerror") worker.onmessageerror?.();
    else {
      worker.onmessage?.({ data: { id: 1, type: "yield" } });
      encoder.grant();
    }
    await expect(pending).resolves.toBeUndefined();
    expect(encoder.failed).toBe(true);
  } finally { encoder.dispose(); }
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it("makes disposal terminal and idempotent without leaking later input", async () => {
  const { encoder, bitmap, worker } = setup();
  const pending = encoder.start(bitmap, 132);
  encoder.dispose();
  await expect(pending).resolves.toBeUndefined();
  encoder.dispose();
  expect(worker.terminate).toHaveBeenCalledOnce();
  const later = { close: vi.fn() } as unknown as ImageBitmap;
  const sent = worker.postMessage.mock.calls.length;
  const ignored = encoder.start(later, 132);
  expect(later.close).toHaveBeenCalledOnce();
  await expect(ignored).resolves.toBeUndefined();
  expect(worker.postMessage).toHaveBeenCalledTimes(sent);
  expect(worker.onmessage).toBeNull();
  expect(worker.onerror).toBeNull();
  expect(worker.onmessageerror).toBeNull();
});
