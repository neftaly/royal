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
  it("keeps an explicitly encoded ETC2 source distinct from auto-decoded bytes", () => {
    const ordinary = textureAsset({ contentKey: "hero", src: "/content" });
    const etc2 = { ...ordinary, sourceEncoding: "ktx2-etc2" as const };
    expect(decodedTextureKey(etc2)).not.toBe(decodedTextureKey(ordinary));
    expect(textureStorageKey(etc2)).not.toBe(textureStorageKey(ordinary));
    expect(() => decodedTextureKey({
      ...ordinary,
      sourceEncoding: "basis" as "ktx2-etc2",
    })).toThrow("sourceEncoding must be ktx2-etc2, ktx2-native, or ktx2-astc");
  });

  it.each([false, true])("restores fitted raster detail after budget growth, early increase %s", async early => {
    const first = { ...decoded(), width: 8, height: 8, sourceWidth: 64, sourceHeight: 64 };
    const full = { ...decoded(), width: 64, height: 64 };
    let finish!: (source: DecodedTextureSource) => void;
    const decode = vi.fn<TextureAssetOwnerPlatform["decode"]>()
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue(full);
    const owner = new TextureAssetOwner({ decode, onAssetChanged: vi.fn(), onListenerError: vi.fn(), onSnapshotChanged: vi.fn() });
    const asset = imageTexture("/fitted.png");
    try {
      owner.reconcile([asset], [], 512);
      if (early) owner.reconcile([asset], [], 32768);
      finish(first);
      await waitFor(() => expect(owner.decoded(asset)?.width).toBe(8));
      owner.releaseUploaded([textureStorageKey(asset)]);
      if (!early) owner.reconcile([asset], [], 32768);
      await waitFor(() => expect(owner.decoded(asset)?.width).toBe(64));
      expect(first.close).toHaveBeenCalledTimes(1);
      expect(full.close).not.toHaveBeenCalled();
      owner.releaseUploaded([textureStorageKey(asset)]);
      for (let index = 0; index < 100; index++) owner.reconcile([asset], [], 32768);
      expect(decode).toHaveBeenCalledTimes(2);
      expect(full.close).toHaveBeenCalledTimes(1);
    } finally { owner.dispose(); }
  });

  it("releases a fitted raster lease only when additional budget can restore detail", async () => {
    const first = { ...decoded(), width: 8, height: 8, sourceWidth: 64, sourceHeight: 64 };
    const full = { ...decoded(), width: 64, height: 64 };
    const decode = vi.fn<TextureAssetOwnerPlatform["decode"]>().mockResolvedValueOnce(first).mockResolvedValue(full);
    let release!: () => void;
    const releaseDecoded = vi.fn(() => release());
    const owner = new TextureAssetOwner({ decode, releaseDecoded, onAssetChanged: vi.fn(), onListenerError: vi.fn(), onSnapshotChanged: vi.fn() });
    const asset = imageTexture("/leased.png");
    try {
      owner.reconcile([asset], [], 512);
      await waitFor(() => expect(owner.decoded(asset)).toBe(first));
      release = owner.acquireDecoded(asset)!.release;
      owner.releaseUploaded([textureStorageKey(asset)]);
      owner.reconcile([asset], [], 512);
      expect(first.close).not.toHaveBeenCalled();
      expect(releaseDecoded).not.toHaveBeenCalled();
      owner.reconcile([asset], [], 32768);
      await waitFor(() => expect(owner.decoded(asset)).toBe(full));
      expect(releaseDecoded).toHaveBeenCalledOnce();
      expect(first.close).toHaveBeenCalledOnce();
      expect(decode).toHaveBeenCalledTimes(2);
      owner.releaseUploaded([textureStorageKey(asset)]);
    } finally { owner.dispose(); }
  });

  it("restores discarded native mip levels by decoding the source again once", async () => {
    const make = (size: number): DecodedTextureSource => ({ kind: "ktx2-etc2", colorSpace: "srgb", width: size, height: size,
      sourceWidth: 64, sourceHeight: 64, close: vi.fn(), levels: [{ width: size, height: size, blocks: new Uint8Array(size * size) }] });
    const first = make(8), full = make(64);
    const decode = vi.fn<TextureAssetOwnerPlatform["decode"]>().mockResolvedValueOnce(first).mockResolvedValue(full);
    const owner = new TextureAssetOwner({ decode, onAssetChanged: vi.fn(), onListenerError: vi.fn(), onSnapshotChanged: vi.fn() });
    const asset = imageTexture("/native.ktx2");
    try {
      owner.reconcile([asset], [], 128);
      await waitFor(() => expect(owner.decoded(asset)).toBe(first));
      owner.releaseUploaded([textureStorageKey(asset)]);
      owner.reconcile([asset], [], 8192);
      await waitFor(() => expect(owner.decoded(asset)).toBe(full));
      owner.releaseUploaded([textureStorageKey(asset)]);
      for (let index = 0; index < 100; index++) owner.reconcile([asset], [], 8192);
      expect(decode).toHaveBeenCalledTimes(2);
      expect(first.close).toHaveBeenCalledOnce();
      expect(full.close).toHaveBeenCalledOnce();
    } finally { owner.dispose(); }
  });

  it("preloads every claimed source independently of complete preparation admission", () => {
    const decode = vi.fn<TextureAssetOwnerPlatform["decode"]>(
      () => new Promise<DecodedTextureSource>(() => undefined),
    );
    const preloadedSignals: AbortSignal[] = [];
    const preload = vi.fn<NonNullable<TextureAssetOwnerPlatform["preload"]>>(
      (_asset, signal) => {
        preloadedSignals.push(signal);
      },
    );
    const owner = new TextureAssetOwner({
      decode,
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      onSnapshotChanged: vi.fn(),
      preload,
    });
    const assets = Array.from({ length: 70 }, (_value, index) =>
      imageTexture(`/texture-${index}.avif`));

    owner.reconcile(assets);

    expect(preload).toHaveBeenCalledTimes(70);
    expect(decode).toHaveBeenCalledTimes(32);
    expect(preloadedSignals.every((signal) => !signal.aborted)).toBe(true);

    owner.reconcile([]);
    expect(preloadedSignals.every((signal) => signal.aborted)).toBe(true);
  });

  it("attributes built-in transport and decode stages without timing custom decoders", async () => {
    let now = 0;
    const owner = new TextureAssetOwner({
      decode: vi.fn(async () => {
        now = 20;
        return {
          ...decoded(),
          timings: {
            decodeDurationMs: 7,
            decodeQueueDurationMs: 3,
            transportDurationMs: 5,
            transportQueueDurationMs: 2,
          },
        };
      }),
      now: () => now,
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      onSnapshotChanged: vi.fn(),
    });
    const asset = imageTexture("/timed.avif");
    owner.reconcile([asset]);

    await waitFor(() => expect(owner.getSnapshot(asset)).toMatchObject({
      status: "ready",
      timings: {
        decodeDurationMs: 7,
        decodeQueueDurationMs: 3,
        firstReadyAfterMs: 20,
        preparationDurationMs: 20,
        preparationQueueDurationMs: 0,
        transportDurationMs: 5,
        transportQueueDurationMs: 2,
      },
    }));
    expect(owner.snapshot().browserStageTimings).toEqual({
      sourceCount: 1,
      totals: {
        decodeDurationMs: 7,
        decodeQueueDurationMs: 3,
        transportDurationMs: 5,
        transportQueueDurationMs: 2,
      },
    });
  });

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

  it("derives lifecycle identity from the current descriptor value", async () => {
    const decode = vi.fn<TextureAssetOwnerPlatform["decode"]>(async () => decoded());
    const owner = new TextureAssetOwner({
      decode,
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      onSnapshotChanged: vi.fn(),
    });
    const asset = imageTexture("/before-hot-reload.png");
    owner.reconcile([asset]);
    await waitFor(() => expect(owner.getSnapshot(asset).status).toBe("ready"));

    (asset as { src: string }).src = "/after-hot-reload.png";
    owner.reconcile([asset]);

    expect(owner.getSnapshot(asset)).toEqual({ status: "loading" });
    await waitFor(() => expect(owner.getSnapshot(asset).status).toBe("ready"));
    expect(decode).toHaveBeenCalledTimes(2);
    expect(decode.mock.calls[1]![0]).toBe(asset);
  });

  it("reloads one URI when its explicit content version changes", async () => {
    const decode = vi.fn<TextureAssetOwnerPlatform["decode"]>(async () => decoded());
    const owner = new TextureAssetOwner({
      decode,
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      onSnapshotChanged: vi.fn(),
    });
    const first = imageTexture({ src: "/hot-reload.png", version: 1 });
    owner.reconcile([first]);
    await waitFor(() => expect(owner.getSnapshot(first).status).toBe("ready"));

    const changed = imageTexture({ src: "/hot-reload.png", version: 2 });
    owner.reconcile([changed]);
    await waitFor(() => expect(owner.getSnapshot(changed).status).toBe("ready"));

    expect(decode).toHaveBeenCalledTimes(2);
    expect(owner.getSnapshot(first)).toEqual({ status: "idle" });
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

  it("reacquires decoded pixels after resident GPU storage is retired", async () => {
    const first = decoded();
    const second = decoded();
    const decode = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const onSnapshotChanged = vi.fn();
    const owner = new TextureAssetOwner({
      decode,
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      onSnapshotChanged,
    });
    const asset = imageTexture("/reinstalled.avif");
    const storageKey = textureStorageKey(asset);
    owner.reconcile([asset]);
    await waitFor(() => expect(owner.getSnapshot(asset).status).toBe("ready"));
    owner.releaseUploaded([storageKey]);
    expect(first.close).toHaveBeenCalledOnce();

    owner.invalidateStorageResidency([storageKey]);

    expect(owner.decoded(asset)).toBeUndefined();
    expect(owner.getSnapshot(asset)).toEqual({ status: "loading" });
    await waitFor(() => expect(decode).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(owner.getSnapshot(asset).status).toBe("ready"));
    expect(owner.decoded(asset)).toBe(second);
    expect(onSnapshotChanged).toHaveBeenCalled();
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

  it("upgrades alpha while preserving an active representation lease", async () => {
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
    await waitFor(() => expect(owner.alpha(asset)).toBe(alpha));
    expect(decode).toHaveBeenCalledTimes(2);
    expect(firstClose).not.toHaveBeenCalled();
    expect(owner.decoded(asset)).toBe(lease?.source);

    lease?.release();
    expect(firstClose).toHaveBeenCalledOnce();
  });

  it.each(["keep", "release", "remove", "dispose", "failure"])(
    "settles a leased alpha upgrade safely across %s",
    async (transition) => {
      const oldClose = vi.fn();
      const freshClose = vi.fn();
      const source = decoded(oldClose);
      const alpha = { height: 32, values: new Uint8Array(64 * 32), width: 64 };
      let resolve!: (source: DecodedTextureSource) => void;
      let reject!: (error: Error) => void;
      const pending = new Promise<DecodedTextureSource>((accept, fail) => { resolve = accept; reject = fail; });
      const decode = vi.fn<TextureAssetOwnerPlatform["decode"]>()
        .mockResolvedValueOnce(source).mockReturnValueOnce(pending);
      const owner = new TextureAssetOwner({
        decode, onAssetChanged: vi.fn(), onListenerError: vi.fn(), onSnapshotChanged: vi.fn(),
      });
      const asset = imageTexture("/leased-alpha-transition.png");
      owner.reconcile([asset]);
      await waitFor(() => expect(owner.getSnapshot(asset).status).toBe("ready"));
      const first = owner.acquireDecoded(asset)!;
      owner.releaseUploaded([textureStorageKey(asset)]);
      owner.reconcile([asset], [asset]);
      expect(decode).toHaveBeenCalledTimes(2);
      const second = owner.acquireDecoded(asset)!;
      expect(second.source).toBe(source);
      expect(owner.snapshot()).toMatchObject({ activePreparations: 1, sourceReservations: 1 });
      if (transition === "release") {
        first.release();
        second.release();
        expect(oldClose).not.toHaveBeenCalled();
      } else if (transition === "remove") owner.reconcile([]);
      else if (transition === "dispose") owner.dispose();
      else if (transition === "failure") owner.invalidateResidency();

      if (transition === "failure") reject(new Error("alpha read failed"));
      else resolve({ ...decoded(freshClose), alpha });
      if (transition === "remove" || transition === "dispose") {
        await waitFor(() => expect(freshClose).toHaveBeenCalledOnce());
      } else {
        await waitFor(() => expect(owner.snapshot().activePreparations).toBe(0));
        expect(owner.getSnapshot(asset).status).toBe("ready");
        if (transition === "failure") expect(owner.decoded(asset)).toBe(source);
        else expect(owner.alpha(asset)).toBe(alpha);
        if (transition === "keep") {
          expect(oldClose).not.toHaveBeenCalled();
          expect(owner.decoded(asset)).toBe(source);
        }
        if (transition === "release") expect(oldClose).toHaveBeenCalledOnce();
      }
      first.release();
      second.release();
      owner.dispose();
      expect(oldClose).toHaveBeenCalledOnce();
      expect(freshClose).toHaveBeenCalledTimes(transition === "failure" ? 0 : 1);
    },
  );

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

  it("bounds read-ahead lifecycles without waiting for small completed handoffs", async () => {
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
      { length: 34 },
      (_value, index) => imageTexture(`/streamed-${index}.avif`),
    );

    owner.reconcile(assets);
    await waitFor(() => expect(decode).toHaveBeenCalledTimes(32));
    await Promise.resolve();
    expect(decode).toHaveBeenCalledTimes(32);

    completions[0]!(decoded());
    await waitFor(() => expect(decode).toHaveBeenCalledTimes(33));
    expect(owner.getSnapshot(assets[0]!).status).toBe("ready");

    completions[1]!(decoded());
    await waitFor(() => expect(decode).toHaveBeenCalledTimes(34));
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
      { length: 34 },
      (_value, index) => imageTexture(`/large-handoff-${index}.avif`),
    );
    const large = (): DecodedTextureSource => ({
      height: 2_560,
      source: {} as ImageBitmap,
      width: 4_096,
    });

    owner.reconcile(assets);
    await waitFor(() => expect(decode).toHaveBeenCalledTimes(32));
    completions[0]!(large());
    await waitFor(() => expect(decode).toHaveBeenCalledTimes(33));
    completions[1]!(large());
    await waitFor(() => expect(owner.getSnapshot(assets[1]!).status).toBe("ready"));
    expect(decode).toHaveBeenCalledTimes(33);

    owner.releaseUploaded([textureStorageKey(assets[0]!)]);
    await waitFor(() => expect(decode).toHaveBeenCalledTimes(34));
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

  it("preserves retained CPU pixels while invalidating only GPU residency", async () => {
    const source = decoded();
    const decode = vi.fn(async () => source);
    const changed = vi.fn();
    const owner = new TextureAssetOwner({
      decode,
      onAssetChanged: changed,
      onListenerError: vi.fn(),
      onSnapshotChanged: vi.fn(),
    });
    const asset = imageTexture("/retained-restorable.avif");
    owner.reconcile([asset]);
    await waitFor(() => expect(owner.decoded(asset)).toBe(source));
    changed.mockClear();

    owner.invalidateResidency();

    expect(owner.decoded(asset)).toBe(source);
    expect(owner.getSnapshot(asset).status).toBe("ready");
    expect(decode).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledWith(decodedTextureKey(asset));
  });

  it("does not restart active transport or decode when GPU residency is invalidated", async () => {
    let complete: ((source: DecodedTextureSource) => void) | undefined;
    let decodeSignal: AbortSignal | undefined;
    const decode = vi.fn<TextureAssetOwnerPlatform["decode"]>(
      (_asset, signal) => {
        decodeSignal = signal;
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
    );
    const owner = new TextureAssetOwner({
      decode,
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      onSnapshotChanged: vi.fn(),
    });
    const asset = imageTexture("/active-restorable.avif");
    owner.reconcile([asset]);

    owner.invalidateResidency();

    expect(decodeSignal?.aborted).toBe(false);
    expect(decode).toHaveBeenCalledOnce();
    const source = decoded();
    complete?.(source);
    await waitFor(() => expect(owner.decoded(asset)).toBe(source));
    expect(decode).toHaveBeenCalledOnce();
  });

  it("re-decodes released pixels when GPU residency is invalidated", async () => {
    const firstClose = vi.fn();
    const changed = vi.fn();
    const second = decoded();
    const decode = vi.fn()
      .mockResolvedValueOnce(decoded(firstClose))
      .mockResolvedValueOnce(second);
    const owner = new TextureAssetOwner({
      decode,
      onAssetChanged: changed,
      onListenerError: vi.fn(),
      onSnapshotChanged: vi.fn(),
    });
    const asset = imageTexture("/restorable.avif");
    owner.reconcile([asset]);
    await waitFor(() => expect(owner.getSnapshot(asset).status).toBe("ready"));
    owner.releaseUploaded([textureStorageKey(asset)]);
    changed.mockClear();

    owner.invalidateResidency();

    expect(owner.decoded(asset)).toBeUndefined();
    // Canonical materials must drop their closed bitmap before any restore draw.
    expect(changed).toHaveBeenCalledExactlyOnceWith(decodedTextureKey(asset));
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
