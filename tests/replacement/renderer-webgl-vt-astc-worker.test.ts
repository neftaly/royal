import { afterEach, expect, it, vi } from "vitest";
const registered = vi.hoisted(() => ({ methods: {} as Record<string, (...args: any[]) => any> }));
vi.mock("../../packages/renderer-webgl/src/workers/runtime", () => ({ loadWorkerRuntime: async () => ({
  worker: (methods: typeof registered.methods) => { registered.methods = methods; },
  Transfer: class { message: unknown; transfer: unknown[]; constructor(message: unknown, transfer: unknown[]) { this.message = message; this.transfer = transfer; } },
}) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules(); });
it("initializes once, closes input and encodes exactly one block row per RPC", async () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const encode = vi.fn((_context: number, _input: number, _width: number, height: number, output: number, bytes: number) => {
    expect(height).toBe(6);
    new Uint8Array(memory.buffer, output, bytes).fill(encode.mock.calls.length);
    return 0;
  });
  const codec = { memory, _initialize: vi.fn(), create_encoder: vi.fn(() => 1), free: vi.fn(), malloc: () => 16, encode };
  const instantiate = vi.spyOn(WebAssembly, "instantiateStreaming").mockResolvedValue({ instance: { exports: codec } } as never);
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("OffscreenCanvas", class {
    getContext() { return { drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(12 * 12 * 4) }) }; }
  });
  await import("../../packages/renderer-webgl/src/virtual-texture/astc/idle-astc-worker");
  const bitmap = { close: vi.fn() };
  await registered.methods.start!(bitmap, 12);
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(encode).not.toHaveBeenCalled();
  expect(registered.methods.step!()).toBeUndefined();
  const complete = registered.methods.step!();
  expect(Array.from(complete.message)).toEqual([...Array(32).fill(1), ...Array(32).fill(2)]);
  expect(complete.transfer).toEqual([complete.message.buffer]);
  expect(() => registered.methods.step!()).toThrow("No active ASTC page");
  await registered.methods.start!(bitmap, 12);
  expect(instantiate).toHaveBeenCalledOnce();
  await expect(registered.methods.start!(bitmap, 7)).rejects.toThrow("Unsupported ASTC page size");
  expect(bitmap.close).toHaveBeenCalledTimes(3);
});
