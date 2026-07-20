import { imageTexture, textureAsset } from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import {
  decodedTextureKey,
  textureStorageKey,
  TextureAssetOwner,
  type DecodedTextureSource,
  type TextureAssetOwnerPlatform,
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
    const decode = vi.fn<TextureAssetOwnerPlatform["decode"]>(async () => decoded());
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

  it("releases decoded pixels after upload while retaining the resident binding identity", async () => {
    const close = vi.fn();
    const source = decoded(close);
    const decode = vi.fn(async () => source);
    const owner = new TextureAssetOwner({
      decode,
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      onSnapshotChanged: vi.fn(),
    });
    const asset = imageTexture("/large.avif");
    owner.reconcile([asset]);
    await vi.waitFor(() => expect(owner.getSnapshot(asset).state).toBe("ready"));

    owner.releaseUploaded([textureStorageKey(asset)]);

    expect(close).toHaveBeenCalledTimes(1);
    expect(owner.decoded(asset)).toBe(source);
    owner.reconcile([asset]);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("transfers decoded pixel lifetime through explicit representation leases", async () => {
    const close = vi.fn();
    const source = decoded(close);
    const owner = new TextureAssetOwner({
      decode: vi.fn(async () => source),
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      onSnapshotChanged: vi.fn(),
    });
    const asset = imageTexture("/automatic-vt.png");
    owner.reconcile([asset]);
    await vi.waitFor(() => expect(owner.getSnapshot(asset).state).toBe("ready"));

    const lease = owner.acquireDecoded(asset);
    expect(lease?.source).toBe(source);
    owner.releaseUploaded([textureStorageKey(asset)]);
    expect(close).not.toHaveBeenCalled();

    lease?.release();
    lease?.release();
    expect(close).toHaveBeenCalledOnce();
    expect(owner.acquireDecoded(asset)).toBeUndefined();
  });

  it("closes an active representation lease exactly once during owner disposal", async () => {
    const close = vi.fn();
    const owner = new TextureAssetOwner({
      decode: vi.fn(async () => decoded(close)),
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      onSnapshotChanged: vi.fn(),
    });
    const asset = imageTexture("/disposed-automatic-vt.png");
    owner.reconcile([asset]);
    await vi.waitFor(() => expect(owner.getSnapshot(asset).state).toBe("ready"));
    const lease = owner.acquireDecoded(asset);

    owner.dispose();
    lease?.release();

    expect(close).toHaveBeenCalledOnce();
  });

  it("defers alpha upgrades until an active representation lease releases", async () => {
    const firstClose = vi.fn();
    const alpha = { height: 32, values: new Uint8Array(64 * 32), width: 64 };
    const decode = vi.fn<TextureAssetOwnerPlatform["decode"]>()
      .mockResolvedValueOnce(decoded(firstClose))
      .mockResolvedValueOnce({ ...decoded(), alpha });
    const owner = new TextureAssetOwner({
      decode,
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      onSnapshotChanged: vi.fn(),
    });
    const asset = imageTexture("/leased-cutout.png");
    owner.reconcile([asset]);
    await vi.waitFor(() => expect(owner.getSnapshot(asset).state).toBe("ready"));
    const lease = owner.acquireDecoded(asset);
    owner.releaseUploaded([textureStorageKey(asset)]);

    owner.reconcile([asset], [asset]);
    await Promise.resolve();
    expect(decode).toHaveBeenCalledOnce();
    expect(firstClose).not.toHaveBeenCalled();

    lease?.release();
    await vi.waitFor(() => expect(owner.alpha(asset)).toBe(alpha));
    expect(decode).toHaveBeenCalledTimes(2);
    expect(firstClose).toHaveBeenCalledOnce();
  });

  it("retains one compact alpha plane only while an alpha-mask pick claim exists", async () => {
    const close = vi.fn();
    const alpha = { height: 32, values: new Uint8Array(64 * 32), width: 64 };
    const decode = vi.fn<TextureAssetOwnerPlatform["decode"]>(async () => ({
      ...decoded(close),
      alpha,
    }));
    const owner = new TextureAssetOwner({
      decode,
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      onSnapshotChanged: vi.fn(),
    });
    const asset = imageTexture("/cutout.png");

    owner.reconcile([asset], [asset]);
    await vi.waitFor(() => expect(owner.alpha(asset)).toBe(alpha));
    expect(decode.mock.calls[0]![3]).toBe(true);
    owner.releaseUploaded([textureStorageKey(asset)]);
    expect(close).toHaveBeenCalledOnce();
    expect(owner.alpha(asset)).toBe(alpha);

    owner.reconcile([asset]);
    expect(owner.alpha(asset)).toBeUndefined();
    expect(decode).toHaveBeenCalledOnce();
  });

  it("upgrades an already resident texture when alpha-mask demand appears", async () => {
    const alpha = { height: 32, values: new Uint8Array(64 * 32), width: 64 };
    const decode = vi.fn<TextureAssetOwnerPlatform["decode"]>()
      .mockResolvedValueOnce(decoded())
      .mockResolvedValueOnce({ ...decoded(), alpha });
    const owner = new TextureAssetOwner({
      decode,
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      onSnapshotChanged: vi.fn(),
    });
    const asset = imageTexture("/late-cutout.png");
    owner.reconcile([asset]);
    await vi.waitFor(() => expect(owner.getSnapshot(asset).state).toBe("ready"));
    owner.releaseUploaded([textureStorageKey(asset)]);

    owner.reconcile([asset], [asset]);

    await vi.waitFor(() => expect(owner.alpha(asset)).toBe(alpha));
    expect(decode).toHaveBeenCalledTimes(2);
    expect(decode.mock.calls[1]![3]).toBe(true);
  });

  it("does not busy-loop when an injected decoder cannot retain alpha", async () => {
    const decode = vi.fn<TextureAssetOwnerPlatform["decode"]>(async () => decoded());
    const owner = new TextureAssetOwner({
      decode,
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      onSnapshotChanged: vi.fn(),
    });
    const asset = imageTexture("/adapter-without-alpha.png");
    owner.reconcile([asset], [asset]);
    await vi.waitFor(() => expect(owner.getSnapshot(asset).state).toBe("ready"));
    owner.releaseUploaded([textureStorageKey(asset)]);
    await Promise.resolve();

    expect(owner.alpha(asset)).toBeUndefined();
    expect(decode).toHaveBeenCalledOnce();
  });

  it("holds a bounded decode reservation until each source is consumed or transferred", async () => {
    const decode = vi.fn(async () => decoded());
    const owner = new TextureAssetOwner({
      decode,
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      onSnapshotChanged: vi.fn(),
    });
    const assets = Array.from(
      { length: 10 },
      (_value, index) => imageTexture(`/streamed-${index}.avif`),
    );

    owner.reconcile(assets);
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(8));
    await Promise.resolve();
    expect(decode).toHaveBeenCalledTimes(8);

    const lease = owner.acquireDecoded(assets[0]!);
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(9));
    expect(owner.getSnapshot(assets[8]!).state).toBe("ready");

    owner.rejectGpuStorage([textureStorageKey(assets[1]!)]);
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(10));
    expect(owner.getSnapshot(assets[9]!).state).toBe("ready");
    lease?.release();
  });

  it("shares the root texture storage allowance across active representations", async () => {
    const decode = vi.fn<TextureAssetOwnerPlatform["decode"]>(async () => decoded());
    const owner = new TextureAssetOwner({
      decode,
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      onSnapshotChanged: vi.fn(),
    }, 1024);
    const assets = [imageTexture("/a.avif"), imageTexture("/b.avif")];

    owner.reconcile(assets);
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(2));

    expect(decode.mock.calls[0]![2]).toBe(512);
    expect(decode.mock.calls[1]![2]).toBe(512);
  });

  it("re-decodes released pixels when GPU residency is invalidated", async () => {
    const firstClose = vi.fn();
    const second = decoded();
    const decode = vi.fn()
      .mockResolvedValueOnce(decoded(firstClose))
      .mockResolvedValueOnce(second);
    const owner = new TextureAssetOwner({
      decode,
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      onSnapshotChanged: vi.fn(),
    });
    const asset = imageTexture("/restorable.avif");
    owner.reconcile([asset]);
    await vi.waitFor(() => expect(owner.getSnapshot(asset).state).toBe("ready"));
    owner.releaseUploaded([textureStorageKey(asset)]);

    owner.invalidateResidency();

    expect(owner.decoded(asset)).toBeUndefined();
    expect(owner.getSnapshot(asset)).toEqual({ state: "loading" });
    await vi.waitFor(() => expect(owner.decoded(asset)).toBe(second));
    expect(decode).toHaveBeenCalledTimes(2);
    expect(firstClose).toHaveBeenCalledTimes(1);
  });

  it("closes and settles decoded pixels when persistent GPU admission is denied", async () => {
    const close = vi.fn();
    const changed = vi.fn();
    const owner = new TextureAssetOwner({
      decode: vi.fn(async () => decoded(close)),
      onAssetChanged: changed,
      onListenerError: vi.fn(),
      onSnapshotChanged: vi.fn(),
    });
    const asset = imageTexture("/over-budget.avif");
    owner.reconcile([asset]);
    await vi.waitFor(() => expect(owner.getSnapshot(asset).state).toBe("ready"));

    owner.rejectGpuStorage([textureStorageKey(asset)]);

    expect(close).toHaveBeenCalledTimes(1);
    expect(owner.decoded(asset)).toBeUndefined();
    expect(owner.getSnapshot(asset)).toEqual({
      error: "Royal persistent GPU budget denied texture storage",
      state: "error",
    });
    expect(changed).toHaveBeenCalledTimes(2);
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
    expect(changed).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledWith(decodedTextureKey(asset));
    expect(snapshotChanged).toHaveBeenCalledWith(decodedTextureKey(asset));
  });
});
