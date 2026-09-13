import { afterEach, expect, it, vi } from "vitest";
import { createBrowserTextureDecoder } from "../../packages/renderer-webgl/src/texture/browser-decode";
import { TextureAssetOwner } from "../../packages/renderer-webgl/src/texture/asset-owner";
import type { TextureSourceRef } from "../../packages/renderer-webgl/src/texture/source";
import { createKtx2Fixture } from "../../tests/replacement/support/ktx2-fixture";
import { fakeGl } from "../../tests/replacement/support/canvas-root-harness";
import { waitFor } from "../../tests/replacement/support/wait-for";

afterEach(() => vi.unstubAllGlobals());

// Diagnostic characterization, not the desired failure-isolation contract.
it.each([134, 138, 146, 152, 166, 172].flatMap(vk =>
  [false, true].flatMap(explicit => [false, true].map(invalidFirst => ({ vk, explicit, invalidFirst }))),
))("records native sharing: $vk, explicit $explicit, invalid first $invalidFirst", async ({ vk, explicit, invalidFirst }) => {
  const sourceEncoding = explicit ? "ktx2-native" as const : undefined;
  const bytes = createKtx2Fixture(vk, 16, 16);
  const gl = fakeGl();
  Object.assign(gl, { getExtension: vi.fn(() => ({ getSupportedProfiles: () => ["ldr"] })) });
  const fetch = vi.fn(async () => new Response(bytes.slice().buffer as ArrayBuffer, {
    headers: { "content-type": "image/ktx2" },
  }));
  vi.stubGlobal("fetch", fetch);
  const decoder = createBrowserTextureDecoder(4, true, undefined, undefined, undefined, gl);
  const owner = new TextureAssetOwner({
    decode: decoder.decode,
    onAssetChanged: vi.fn(), onSnapshotChanged: vi.fn(), onListenerError: vi.fn(),
  });
  const valid = {
    kind: "asset", src: "/shared-native.ktx2", colorSpace: "srgb",
    ...(sourceEncoding === undefined ? {} : { sourceEncoding }),
  } satisfies TextureSourceRef;
  const invalid: TextureSourceRef = { ...valid, colorSpace: "linear" };
  try {
    owner.reconcile(invalidFirst ? [invalid, valid] : [valid, invalid]);
    await waitFor(() => expect(owner.getSnapshot(valid).status).toBe(invalidFirst ? "error" : "ready"));
    expect(fetch).toHaveBeenCalledOnce();
    owner.reconcile([valid]);
    // Removing the invalid claim does not restart the retained source identity.
    expect(owner.getSnapshot(valid).status).toBe(invalidFirst ? "error" : "ready");
    expect(owner.decoded(valid)?.kind).toBe(invalidFirst ? undefined : vk === 152 ? "ktx2-etc2" : "ktx2-native");
    for (let frame = 0; frame < 50; frame++) owner.reconcile([valid]);
    expect(fetch).toHaveBeenCalledOnce();
    const replacement = { ...valid, version: 1 };
    owner.reconcile([replacement]);
    await waitFor(() => expect(owner.getSnapshot(replacement).status).toBe("ready"));
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    owner.dispose();
  }
});
