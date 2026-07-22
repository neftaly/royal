import { describe, expect, it, vi } from "vitest";
import {
  SharedByteReadOwner,
} from "../../packages/renderer-webgl/src/resource/shared-byte-read-owner";

describe("shared byte read owner", () => {
  it("preserves zero-copy delivery for one consumer", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const owner = new SharedByteReadOwner<string>();

    await expect(owner.read("single", "only", async () => bytes)).resolves.toBe(bytes);
    owner.dispose();
  });

  it("shares transport while returning caller-owned storage", async () => {
    const start = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const owner = new SharedByteReadOwner<string>();
    const [first, second] = await Promise.all([
      owner.read("shared", "first", start),
      owner.read("shared", "second", start),
    ]);

    expect(start).toHaveBeenCalledOnce();
    expect(first).not.toBe(second);
    first[0] = 9;
    expect(second).toEqual(new Uint8Array([1, 2, 3]));
    owner.dispose();
  });

  it("aborts only after the last consumer releases a pending read", async () => {
    let signal: AbortSignal | undefined;
    const owner = new SharedByteReadOwner<string>();
    const start = vi.fn((nextSignal: AbortSignal) => {
      signal = nextSignal;
      return new Promise<Uint8Array>(() => undefined);
    });
    void owner.read("shared", "first", start);
    void owner.read("shared", "second", start);
    await Promise.resolve();

    owner.release("first");
    expect(signal?.aborted).toBe(false);
    owner.release("second");
    expect(signal?.aborted).toBe(true);
  });

  it("does not retain a rejected transport as a sticky cache entry", async () => {
    const start = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(new Uint8Array([4]));
    const owner = new SharedByteReadOwner<string>();

    await expect(owner.read("shared", "first", start)).rejects.toThrow("temporary");
    await expect(owner.read("shared", "second", start)).resolves.toEqual(new Uint8Array([4]));
    expect(start).toHaveBeenCalledTimes(2);
    owner.dispose();
  });

  it("retires oversized settled reads while still sharing concurrent transport", async () => {
    const start = vi.fn(async () => new Uint8Array([1, 2]));
    const owner = new SharedByteReadOwner<string>(1);
    const first = owner.read("large", "first", start);
    const second = owner.read("large", "second", start);
    await Promise.all([first, second]);
    await owner.read("large", "third", start);

    expect(start).toHaveBeenCalledTimes(2);
    owner.dispose();
  });
});
