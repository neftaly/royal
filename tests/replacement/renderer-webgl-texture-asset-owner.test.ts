import { imageTexture, textureAsset } from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { waitFor } from "./support/wait-for";
import {
  decodedTextureHandoffBytes,
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
    expect(owner.getSnapshot(first)).toEqual({ status: "loading" });
    await waitFor(() => expect(owner.getSnapshot(second)).toEqual({
      height: 32,
      status: "ready",
      width: 64,
    }));
    expect(decode).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith(decodedTextureKey(first));
  });

  it("keeps an explicitly encoded ETC2 source distinct from auto-decoded bytes", () => {
    const ordinary = textureAsset({ contentKey: "hero", src: "/content" });
    const etc2 = { ...ordinary, sourceEncoding: "ktx2-etc2" as const };
    expect(decodedTextureKey(etc2)).not.toBe(decodedTextureKey(ordinary));
    expect(textureStorageKey(etc2)).not.toBe(textureStorageKey(ordinary));
    expect(() => decodedTextureKey({
      ...ordinary,
      sourceEncoding: "basis" as "ktx2-etc2",
    })).toThrow("sourceEncoding must be ktx2-etc2 or svg");
  });

  it("keeps a preferred SVG and fallback in one logical decoded identity", async () => {
    const preferred = {
      fallback: { kind: "asset" as const, src: "/fallback.png" },
      kind: "asset" as const,
      sourceEncoding: "svg" as const,
      src: "/preferred.svg",
    };
    expect(decodedTextureKey(preferred)).not.toBe(decodedTextureKey({
      ...preferred,
      fallback: { kind: "asset", src: "/other.png" },
    }));
    expect(() => decodedTextureKey({
      fallback: { kind: "asset", src: "/fallback.png" },
      kind: "asset",
      src: "/preferred.png",
    })).toThrow("fallback requires a preferred svg source");

    const owner = new TextureAssetOwner({
      decode: vi.fn(async () => ({ ...decoded(), fallbackReason: "preferred SVG failed" })),
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      onSnapshotChanged: vi.fn(),
    });
    owner.reconcile([preferred]);
    await waitFor(() => expect(owner.getSourceSnapshot(preferred)).toEqual({
      fallbackReason: "preferred SVG failed",
      height: 32,
      status: "ready",
      width: 64,
    }));
  });

  it("keeps concurrent out-of-order decode results attached to their content identities", async () => {
    const completions = new Map<string, (source: DecodedTextureSource) => void>();
    const owner = new TextureAssetOwner({
      decode: vi.fn((asset) => new Promise<DecodedTextureSource>((resolve) => {
        if (asset.kind !== "asset") throw new Error("expected an external texture asset");
        completions.set(asset.src, resolve);
      })),
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      onSnapshotChanged: vi.fn(),
    });
    const first = imageTexture("/first.png");
    const second = imageTexture("/second.png");
    const firstDecoded = decoded();
    const secondDecoded = decoded();
    owner.reconcile([first, second]);

    completions.get(second.src)!(secondDecoded);
    await waitFor(() => expect(owner.getSnapshot(second).status).toBe("ready"));
    expect(owner.decoded(first)).toBeUndefined();
    expect(owner.decoded(second)).toBe(secondDecoded);

    completions.get(first.src)!(firstDecoded);
    await waitFor(() => expect(owner.getSnapshot(first).status).toBe("ready"));
    expect(owner.decoded(first)).toBe(firstDecoded);
    expect(owner.decoded(second)).toBe(secondDecoded);
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
    await waitFor(() => expect(owner.getSnapshot(asset).status).toBe("ready"));

    owner.releaseUploaded([textureStorageKey(asset)]);

    expect(close).toHaveBeenCalledTimes(1);
    expect(owner.decoded(asset)).toBe(source);
    owner.reconcile([asset]);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("reports retained encoded vector authority independently of decoded handoff bytes", async () => {
    const source = {
      ...decoded(),
      encodedSvg: {
        blob: new Blob(["<svg/>"]),
        byteLength: 6,
        parsed: { document: {} as XMLDocument, viewBox: [0, 0, 1, 1] as const },
      },
    };
    const owner = new TextureAssetOwner({
      decode: vi.fn(async () => source),
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      onSnapshotChanged: vi.fn(),
    });
    const asset = imageTexture("/vector.svg");
    owner.reconcile([asset]);
    await waitFor(() => expect(owner.getSnapshot(asset).status).toBe("ready"));

    expect(owner.snapshot()).toMatchObject({
      decodedHandoffBytes: 64 * 32 * 4,
      retainedEncodedSourceBytes: 6,
    });
    owner.releaseUploaded([textureStorageKey(asset)]);
    expect(owner.snapshot()).toMatchObject({
      decodedHandoffBytes: 0,
      retainedEncodedSourceBytes: 6,
    });
    owner.reconcile([]);
    expect(owner.snapshot().retainedEncodedSourceBytes).toBe(0);
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
    await waitFor(() => expect(owner.getSnapshot(asset).status).toBe("ready"));

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
    await waitFor(() => expect(owner.getSnapshot(asset).status).toBe("ready"));
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
    await waitFor(() => expect(owner.getSnapshot(asset).status).toBe("ready"));
    const lease = owner.acquireDecoded(asset);
    owner.releaseUploaded([textureStorageKey(asset)]);

    owner.reconcile([asset], [asset]);
    await Promise.resolve();
    expect(decode).toHaveBeenCalledOnce();
    expect(firstClose).not.toHaveBeenCalled();

    lease?.release();
    await waitFor(() => expect(owner.alpha(asset)).toBe(alpha));
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
    await waitFor(() => expect(owner.getSnapshot(asset).status).toBe("ready"));
    expect(owner.alpha(asset)).toBeUndefined();
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
    await waitFor(() => expect(owner.getSnapshot(asset).status).toBe("ready"));
    owner.releaseUploaded([textureStorageKey(asset)]);

    owner.reconcile([asset], [asset]);

    await waitFor(() => expect(owner.alpha(asset)).toBe(alpha));
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
    await waitFor(() => expect(owner.getSnapshot(asset).status).toBe("ready"));
    owner.releaseUploaded([textureStorageKey(asset)]);
    await Promise.resolve();

    expect(owner.alpha(asset)).toBeUndefined();
    expect(decode).toHaveBeenCalledOnce();
  });

  it("bounds active unknown-size decodes without waiting for small completed handoffs", async () => {
    const completions: Array<(source: DecodedTextureSource) => void> = [];
    const decode = vi.fn<TextureAssetOwnerPlatform["decode"]>(() => new Promise((resolve) => {
      completions.push(resolve);
    }));
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
    await waitFor(() => expect(decode).toHaveBeenCalledTimes(8));
    await Promise.resolve();
    expect(decode).toHaveBeenCalledTimes(8);

    completions[0]!(decoded());
    await waitFor(() => expect(decode).toHaveBeenCalledTimes(9));
    expect(owner.getSnapshot(assets[0]!).status).toBe("ready");

    completions[1]!(decoded());
    await waitFor(() => expect(decode).toHaveBeenCalledTimes(10));
    expect(owner.getSnapshot(assets[1]!).status).toBe("ready");
    owner.dispose();
  });

  it("stops new decode work at the actual completed-handoff byte threshold", async () => {
    const completions: Array<(source: DecodedTextureSource) => void> = [];
    const decode = vi.fn<TextureAssetOwnerPlatform["decode"]>(() => new Promise((resolve) => {
      completions.push(resolve);
    }));
    const owner = new TextureAssetOwner({
      decode,
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      onSnapshotChanged: vi.fn(),
    });
    const assets = Array.from(
      { length: 10 },
      (_value, index) => imageTexture(`/large-handoff-${index}.avif`),
    );
    const large = (): DecodedTextureSource => ({
      height: 2_560,
      source: {} as ImageBitmap,
      width: 4_096,
    });

    owner.reconcile(assets);
    await waitFor(() => expect(decode).toHaveBeenCalledTimes(8));
    completions[0]!(large());
    await waitFor(() => expect(decode).toHaveBeenCalledTimes(9));
    completions[1]!(large());
    await waitFor(() => expect(owner.getSnapshot(assets[1]!).status).toBe("ready"));
    expect(decode).toHaveBeenCalledTimes(9);

    owner.releaseUploaded([textureStorageKey(assets[0]!)]);
    await waitFor(() => expect(decode).toHaveBeenCalledTimes(10));
    owner.dispose();
  });

  it("accounts exact image, compressed-level, and retained-alpha handoff bytes", () => {
    const alpha = { height: 8, values: new Uint8Array(64), width: 8 };
    expect(decodedTextureHandoffBytes({
      height: 8,
      source: {} as ImageBitmap,
      width: 8,
    }, alpha)).toBe(320);
    const mipAlpha = {
      ...alpha,
      levels: [alpha, { height: 4, values: new Uint8Array(16), width: 4 }],
    };
    expect(decodedTextureHandoffBytes({
      height: 8,
      source: {} as ImageBitmap,
      width: 8,
    }, mipAlpha)).toBe(336);
    expect(decodedTextureHandoffBytes({
      colorSpace: "srgb",
      height: 8,
      kind: "ktx2-etc2",
      levels: [
        { blocks: new Uint8Array(64), height: 8, width: 8 },
        { blocks: new Uint8Array(16), height: 4, width: 4 },
      ],
      width: 8,
    })).toBe(80);
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
    await waitFor(() => expect(decode).toHaveBeenCalledTimes(2));

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
    await waitFor(() => expect(owner.getSnapshot(asset).status).toBe("ready"));
    owner.releaseUploaded([textureStorageKey(asset)]);

    owner.invalidateResidency();

    expect(owner.decoded(asset)).toBeUndefined();
    expect(owner.getSnapshot(asset)).toEqual({ status: "loading" });
    await waitFor(() => expect(owner.decoded(asset)).toBe(second));
    expect(decode).toHaveBeenCalledTimes(2);
    expect(firstClose).toHaveBeenCalledTimes(1);
  });

  it("closes and settles decoded pixels when persistent GPU admission is denied", async () => {
    const close = vi.fn();
    const changed = vi.fn();
    const snapshotChanged = vi.fn();
    const owner = new TextureAssetOwner({
      decode: vi.fn(async () => decoded(close)),
      onAssetChanged: changed,
      onListenerError: vi.fn(),
      onSnapshotChanged: snapshotChanged,
    });
    const asset = imageTexture("/over-budget.avif");
    owner.reconcile([asset]);
    await waitFor(() => expect(owner.getSnapshot(asset).status).toBe("ready"));

    owner.rejectGpuStorage([textureStorageKey(asset)]);

    expect(close).toHaveBeenCalledTimes(1);
    expect(owner.decoded(asset)).toBeUndefined();
    expect(owner.getSnapshot(asset)).toEqual({ height: 32, status: "ready", width: 64 });
    expect(changed).toHaveBeenCalledTimes(2);
    expect(snapshotChanged).toHaveBeenCalledTimes(1);
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
    expect(owner.getSnapshot(asset)).toEqual({ status: "idle" });
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
    await waitFor(() => expect(owner.getSnapshot(asset).status).toBe("error"));
    const snapshot = owner.getSnapshot(asset);
    if (snapshot.status === "error") expect(snapshot.error.length).toBeLessThanOrEqual(400);
    owner.reconcile([asset]);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledWith(decodedTextureKey(asset));
    expect(snapshotChanged).toHaveBeenCalledWith(decodedTextureKey(asset));
  });
});
