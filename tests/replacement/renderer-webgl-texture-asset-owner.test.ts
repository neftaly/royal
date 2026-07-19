import { imageTexture, textureAsset } from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import {
  decodedTextureKey,
  TextureAssetOwner,
  type DecodedTextureSource,
} from "../../packages/renderer-webgl/src/texture/asset-owner";

const decoded = (close = vi.fn()): DecodedTextureSource => ({
  close,
  height: 32,
  source: {} as ImageBitmap,
  width: 64,
});

describe("ordinary texture asset lifecycle owner", () => {
  it("shares decode by content and version, independently of sampling and color interpretation", async () => {
    const changed = vi.fn();
    const decode = vi.fn(async () => decoded());
    const owner = new TextureAssetOwner({
      decode,
      onAssetChanged: changed,
      onListenerError: vi.fn(),
      onSnapshotChanged: vi.fn(),
    });
    const first = textureAsset({
      colorSpace: "srgb",
      contentKey: "hero",
      sampler: { minFilter: "nearest" },
      src: "/first.png",
      version: 4,
    });
    const second = textureAsset({
      colorSpace: "linear",
      contentKey: "hero",
      sampler: { minFilter: "linear" },
      src: "/mirror.png",
      version: 4,
    });
    expect(decodedTextureKey(first)).toBe(decodedTextureKey(second));
    owner.reconcile([first, second]);
    expect(owner.getSnapshot(first)).toEqual({ state: "loading" });
    await vi.waitFor(() => expect(owner.getSnapshot(second)).toEqual({
      height: 32,
      state: "ready",
      width: 64,
    }));
    expect(decode).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith(decodedTextureKey(first));
  });

  it("aborts and closes released content while ignoring stale completion", async () => {
    let resolveDecode: ((value: DecodedTextureSource) => void) | undefined;
    let signal: AbortSignal | undefined;
    const close = vi.fn();
    const changed = vi.fn();
    const owner = new TextureAssetOwner({
      decode: vi.fn((_asset, nextSignal) => {
        signal = nextSignal;
        return new Promise<DecodedTextureSource>((resolve) => { resolveDecode = resolve; });
      }),
      onAssetChanged: changed,
      onListenerError: vi.fn(),
      onSnapshotChanged: vi.fn(),
    });
    const asset = imageTexture("/slow.png");
    owner.reconcile([asset]);
    owner.reconcile([]);
    expect(signal?.aborted).toBe(true);
    resolveDecode?.(decoded(close));
    await Promise.resolve();
    await Promise.resolve();
    expect(close).toHaveBeenCalledTimes(1);
    expect(owner.getSnapshot(asset)).toEqual({ state: "idle" });
    expect(changed).not.toHaveBeenCalled();
  });

  it("retains bounded terminal failures without retrying each reconciliation", async () => {
    const decode = vi.fn(async () => { throw new Error("x".repeat(800)); });
    const changed = vi.fn();
    const snapshotChanged = vi.fn();
    const owner = new TextureAssetOwner({
      decode,
      onAssetChanged: changed,
      onListenerError: vi.fn(),
      onSnapshotChanged: snapshotChanged,
    });
    const asset = imageTexture("/broken.png");
    owner.reconcile([asset]);
    await vi.waitFor(() => expect(owner.getSnapshot(asset).state).toBe("error"));
    const snapshot = owner.getSnapshot(asset);
    if (snapshot.state === "error") expect(snapshot.error.length).toBeLessThanOrEqual(400);
    owner.reconcile([asset]);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(changed).not.toHaveBeenCalled();
    expect(snapshotChanged).toHaveBeenCalledWith(decodedTextureKey(asset));
  });
});
