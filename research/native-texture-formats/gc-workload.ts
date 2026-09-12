import { TextureGpuOwner } from "../../packages/renderer-webgl/src/texture/gpu-owner";
import { parseKtx2Native } from "../../packages/renderer-webgl/src/texture/ktx2-native";
import { createKtx2Fixture } from "../../tests/replacement/support/ktx2-fixture";
import type { CanonicalTextureBinding } from "../../packages/renderer-webgl/src/surface/canonical-material";

/** Minimal driver isolates JS allocations; these are not GPU timings. */
export const createWorkload = (mode: "etc2" | "astc" | "astc-preview" | "unsupported" | "parse") => {
  let extensionCalls = 0, uploads = 0;
  const extension = { getSupportedProfiles: () => ["ldr"] };
  const noop = () => undefined;
  const gl = {
    getExtension: () => { extensionCalls++; return mode === "unsupported" ? null : extension; },
    createTexture: () => ({}), createSampler: () => ({}),
    compressedTexImage2D: () => { uploads++; },
    activeTexture: noop, bindTexture: noop, samplerParameteri: noop,
    texParameteri: noop, deleteTexture: noop, deleteSampler: noop,
  } as unknown as WebGL2RenderingContext;
  const owner = new TextureGpuOwner(gl);
  const payload = createKtx2Fixture(mode === "etc2" ? 152 : 166, 1024, 1024);
  const texture = parseKtx2Native(payload);
  const binding: CanonicalTextureBinding = {
    colorSpace: "srgb", storageKey: "one", samplerKey: "linear",
    sampler: { minFilter: "linear", magFilter: "linear", wrapS: "repeat", wrapT: "repeat" },
    decoded: texture.format === "etc2-rgba" ? { ...texture, kind: "ktx2-etc2" }
      : { ...texture, format: texture.format, kind: "ktx2-native" },
  };
  if (mode === "astc-preview") Object.assign(binding.decoded!, {
    svgPreview: { load: () => { throw new Error("Cached preview must not load SVG"); } },
  });
  const expected = owner.retain(binding);
  return {
    run: mode === "parse" ? () => { parseKtx2Native(payload); }
      : () => { if (owner.retain(binding) !== expected) throw new Error("Unstable cached binding"); },
    counters: () => ({ extensionCalls, uploads }),
    close: () => owner.dispose(),
  };
};
