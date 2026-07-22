import type { GltfAssetRef } from "@royal/renderer-core";
import type { GltfTextureAssetRef } from "../texture/source";

/** One immutable glTF byte identity requested through a renderer-root host seam. */
export type GltfResourceRead = Readonly<{
  /** Semantic role of these bytes in the supported static glTF profile. */
  kind: "buffer" | "image" | "root";
  /** Root `src` as supplied, or a referenced buffer/image URI resolved against that source. */
  uri: string;
  /** Caller-declared byte revision inherited from the root glTF asset. */
  version?: GltfAssetRef["version"];
}>;

/**
 * Reads complete bytes for one glTF resource identity.
 *
 * Royal owns claim deduplication and cancellation. Equal `uri`/`version`
 * requests within one root must return equal bytes. The returned view becomes
 * Royal-owned and its backing buffer may be transferred; return an unretained
 * view or copy when the host must keep its source storage attached.
 */
export type GltfResourceReader = (
  resource: GltfResourceRead,
  signal: AbortSignal,
) => Promise<Uint8Array>;

/** Stable host dependencies captured for the complete renderer-root lifetime. */
export type RendererRootDependencies = Readonly<{
  /** Overrides transport for glTF roots, buffers, and external images. */
  gltfResourceReader?: GltfResourceReader;
}>;

/** Validates the cold renderer-root dependency boundary before WebGL ownership begins. */
export const resolveRendererRootDependencies = (
  dependencies: RendererRootDependencies = {},
): RendererRootDependencies => {
  if (typeof dependencies !== "object" || dependencies === null || Array.isArray(dependencies)) {
    throw new TypeError("Royal renderer root dependencies must be an object");
  }
  for (const key of Reflect.ownKeys(dependencies)) {
    if (key !== "gltfResourceReader") {
      throw new TypeError(`Royal renderer root dependencies contain unsupported field ${String(key)}`);
    }
  }
  if (
    dependencies.gltfResourceReader !== undefined
    && typeof dependencies.gltfResourceReader !== "function"
  ) {
    throw new TypeError("Royal renderer root dependency gltfResourceReader must be a function");
  }
  return dependencies;
};

export const readHostGltfResource = async (
  reader: GltfResourceReader,
  resource: GltfResourceRead,
  signal: AbortSignal,
): Promise<Uint8Array> => {
  const bytes = await reader(resource, signal);
  if (Object.prototype.toString.call(bytes) !== "[object Uint8Array]") {
    throw new TypeError("Royal glTF resource reader must return Uint8Array bytes");
  }
  return bytes;
};

/** @internal Narrows one public dependency to the private root platform reads. */
export const createGltfResourceReaderPlatform = (
  dependencies: RendererRootDependencies = {},
) => {
  const { gltfResourceReader } = resolveRendererRootDependencies(dependencies);
  if (gltfResourceReader === undefined) return undefined;
  const resource = (
    kind: GltfResourceRead["kind"],
    uri: string,
    version: GltfAssetRef["version"],
  ): GltfResourceRead => ({
    kind,
    uri,
    ...(version === undefined ? {} : { version }),
  });
  return {
    readGltf: (asset: GltfAssetRef, signal: AbortSignal) => readHostGltfResource(
      gltfResourceReader,
      resource("root", asset.src, asset.version),
      signal,
    ),
    readGltfResource: (asset: GltfAssetRef, uri: string, signal: AbortSignal) =>
      readHostGltfResource(
        gltfResourceReader,
        resource("buffer", uri, asset.version),
        signal,
      ),
    readGltfResourceRanges: false as const,
    readGltfTextureResource: (asset: GltfTextureAssetRef, signal: AbortSignal) =>
      readHostGltfResource(
        gltfResourceReader,
        resource("image", asset.src, asset.version),
        signal,
      ),
  };
};
