import { afterEach, describe, expect, it, vi } from "vitest";
import { proveOriginClean } from "../../packages/renderer-webgl/src/texture/origin-clean";

afterEach(() => vi.unstubAllGlobals());

describe("origin-clean bitmap probe", () => {
  it("transfers only the cropped probe and releases both handles", async () => {
    const source = { close: vi.fn() } as unknown as ImageBitmap;
    const probe = { close: vi.fn() };
    const moved = { close: vi.fn() };
    const decode = vi.fn(async () => probe);
    const transfer = vi.fn(() => moved);
    vi.stubGlobal("createImageBitmap", decode);
    vi.stubGlobal("structuredClone", transfer);
    await proveOriginClean(source);
    expect(decode).toHaveBeenCalledWith(source, 0, 0, 1, 1);
    expect(transfer).toHaveBeenCalledWith(probe, { transfer: [probe] });
    expect(probe.close).toHaveBeenCalledOnce();
    expect(moved.close).toHaveBeenCalledOnce();
    expect(source.close).not.toHaveBeenCalled();
  });

  it("propagates taint rejection and releases the temporary bitmap", async () => {
    const probe = { close: vi.fn() };
    const failure = new DOMException("Tainted", "DataCloneError");
    vi.stubGlobal("createImageBitmap", vi.fn(async () => probe));
    vi.stubGlobal("structuredClone", vi.fn(() => { throw failure; }));
    await expect(proveOriginClean({} as ImageBitmap)).rejects.toBe(failure);
    expect(probe.close).toHaveBeenCalledOnce();
  });
});
