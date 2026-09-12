import { createBrowserTextureDecoder } from "../../packages/renderer-webgl/src/texture/browser-decode";
import { createKtx2Fixture } from "../../tests/replacement/support/ktx2-fixture";

export const decodeRetentionFixture = async (vk: number, budget?: number) =>
  createBrowserTextureDecoder().decode({
    kind: "embedded-asset", bytes: createKtx2Fixture(vk, 4096, 4096, 13),
    contentKey: "retention", label: "retention", mimeType: "image/ktx2", sourceEncoding: "ktx2-native",
  }, new AbortController().signal, budget);
