import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules(); });

it.each(["cancel", "replace"])("encodes one block row per grant and handles %s during startup without duplicating the codec", async mode => {
  let initialize!: (value: unknown) => void;
  const memory = new WebAssembly.Memory({ initial: 1 });
  const encode = vi.fn((_context: number, _input: number, _width: number, height: number, output: number, bytes: number) => {
    expect(height).toBe(6);
    new Uint8Array(memory.buffer, output, bytes).fill(encode.mock.calls.length);
    return 0;
  });
  const codec = { memory, _initialize: vi.fn(), create_encoder: vi.fn(() => 1), free: vi.fn(), malloc: () => 16, encode };
  const instantiate = vi.spyOn(WebAssembly, "instantiateStreaming").mockImplementation(() => new Promise(resolve => { initialize = resolve; }) as never);
  vi.stubGlobal("fetch", vi.fn());
  const target = { onmessage: undefined as unknown as (event: { data: unknown }) => Promise<void>, postMessage: vi.fn() };
  vi.stubGlobal("self", target);
  vi.stubGlobal("OffscreenCanvas", class {
    getContext() { return { drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(12 * 12 * 4) }) }; }
  });
  await import("../../packages/renderer-webgl/src/virtual-texture/astc/idle-astc-worker");
  const first = { close: vi.fn() }, second = { close: vi.fn() };
  const obsolete = target.onmessage({ data: { type: "start", id: 1, bitmap: first, size: 12 } });
  if (mode === "cancel") {
    await target.onmessage({ data: { type: "cancel", id: 1 } });
    // Cancellation must release transferred pixels even if the WASM fetch hangs.
    expect(first.close).toHaveBeenCalledOnce();
  }
  const active = target.onmessage({ data: { type: "start", id: 2, bitmap: second, size: 12 } });
  expect(first.close).toHaveBeenCalledOnce();
  expect(second.close).not.toHaveBeenCalled();
  initialize({ instance: { exports: codec } });
  await Promise.all([obsolete, active]);
  expect(instantiate).toHaveBeenCalledTimes(1);
  expect(codec.create_encoder).toHaveBeenCalledTimes(1);
  expect(first.close).toHaveBeenCalledOnce(); expect(second.close).toHaveBeenCalledOnce();
  expect(target.postMessage).toHaveBeenCalledExactlyOnceWith({ id: 2, type: "yield" });
  expect(encode).not.toHaveBeenCalled();
  await target.onmessage({ data: { type: "step", id: 1 } });
  expect(encode).not.toHaveBeenCalled();
  await target.onmessage({ data: { type: "step", id: 2 } });
  expect(encode).toHaveBeenCalledTimes(1);
  await target.onmessage({ data: { type: "step", id: 2 } });
  expect(encode).toHaveBeenCalledTimes(2);
  const complete = target.postMessage.mock.calls.at(-1)![0];
  expect(complete.type).toBe("complete");
  expect(Array.from(complete.blocks)).toEqual([...Array(32).fill(1), ...Array(32).fill(2)]);
  await target.onmessage({ data: { type: "step", id: 2 } });
  expect(encode).toHaveBeenCalledTimes(2);
});
