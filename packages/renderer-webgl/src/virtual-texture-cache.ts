import type { VirtualTextureAssetRef } from "@royal/renderer-core";
import type { RendererWebGlContext } from "./gl";
import { createGeneratedVirtualTexturePageSource } from "./virtual-texture-generated-page-source";
import {
  parseVirtualTextureManifest,
  resolveVirtualTextureManifestPageUri,
  type VirtualTextureManifest,
} from "./virtual-texture-manifest";
import {
  VirtualTextureResource,
  type VirtualTexturePageSource,
  type VirtualTextureResourceStats,
} from "./virtual-texture-resource";

export type VirtualTextureCacheDescriptor = Pick<
  VirtualTextureAssetRef,
  "manifestUri" | "revision"
>;

export type VirtualTextureCacheEntryStatus = "error" | "loading" | "ready";

export type VirtualTextureCacheEntryStats = {
  readonly manifestUri: string;
  readonly status: VirtualTextureCacheEntryStatus;
  readonly error: string | null;
  readonly resource: VirtualTextureResourceStats | null;
  readonly revision?: VirtualTextureAssetRef["revision"];
};

export type VirtualTextureCacheStats = {
  readonly entries: number;
  readonly error: number;
  readonly loading: number;
  readonly ready: number;
};

export type VirtualTextureCacheLoadResult =
  | {
    readonly kind: "error";
    readonly error: unknown;
    readonly stats: VirtualTextureCacheEntryStats;
  }
  | {
    readonly kind: "loading";
    readonly stats: VirtualTextureCacheEntryStats;
  }
  | {
    readonly kind: "ready";
    readonly resource: VirtualTextureResource;
    readonly stats: VirtualTextureCacheEntryStats;
  };

type VirtualTextureCacheEntry =
  | {
    readonly descriptor: VirtualTextureCacheDescriptor;
    readonly key: string;
    readonly kind: "error";
    readonly error: unknown;
  }
  | {
    readonly descriptor: VirtualTextureCacheDescriptor;
    readonly key: string;
    readonly kind: "loading";
    readonly promise: Promise<void>;
  }
  | {
    readonly descriptor: VirtualTextureCacheDescriptor;
    readonly key: string;
    readonly kind: "ready";
    readonly resource: VirtualTextureResource;
  };

export class VirtualTextureCache {
  readonly #entries = new Map<string, VirtualTextureCacheEntry>();
  readonly #gl: RendererWebGlContext;
  #disposed = false;

  constructor(gl: RendererWebGlContext) {
    this.#gl = gl;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const entry of this.#entries.values()) {
      if (entry.kind === "ready") entry.resource.dispose();
    }
    this.#entries.clear();
  }

  loadVirtualTexture(
    descriptor: VirtualTextureCacheDescriptor,
    onSettled?: () => void,
  ): VirtualTextureCacheLoadResult {
    this.#assertLive();
    const key = virtualTextureCacheKey(descriptor);
    const existing = this.#entries.get(key);
    if (existing !== undefined) return virtualTextureCacheLoadResult(existing);

    const loading: VirtualTextureCacheEntry = {
      descriptor,
      key,
      kind: "loading",
      promise: this.#loadResource(descriptor)
        .then((resource) => {
          if (this.#disposed) {
            resource.dispose();
            return;
          }
          if (this.#entries.get(key) !== loading) {
            resource.dispose();
            return;
          }
          this.#entries.set(key, {
            descriptor,
            key,
            kind: "ready",
            resource,
          });
          onSettled?.();
        })
        .catch((error: unknown) => {
          if (this.#disposed || this.#entries.get(key) !== loading) return;
          this.#entries.set(key, {
            descriptor,
            error,
            key,
            kind: "error",
          });
          onSettled?.();
        }),
    };

    this.#entries.set(key, loading);
    return virtualTextureCacheLoadResult(loading);
  }

  stats(): VirtualTextureCacheStats {
    let error = 0;
    let loading = 0;
    let ready = 0;
    for (const entry of this.#entries.values()) {
      switch (entry.kind) {
        case "error":
          error += 1;
          break;
        case "loading":
          loading += 1;
          break;
        case "ready":
          ready += 1;
          break;
      }
    }
    return {
      entries: this.#entries.size,
      error,
      loading,
      ready,
    };
  }

  async waitForPendingLoads(): Promise<void> {
    this.#assertLive();
    await Promise.all([...this.#entries.values()].map((entry) => (
      entry.kind === "loading" ? entry.promise : Promise.resolve()
    )));
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error("Virtual texture cache has been disposed");
  }

  async #loadResource(descriptor: VirtualTextureCacheDescriptor): Promise<VirtualTextureResource> {
    const manifestUri = resolveVirtualTextureUri(descriptor.manifestUri);
    const response = await fetch(manifestUri);
    if (!response.ok) {
      throw new Error(`Failed to load virtual texture manifest ${manifestUri}: ${response.status}`);
    }

    const manifest = withManifestPageBaseUri(
      parseVirtualTextureManifest(await response.json()),
      manifestUri,
    );
    return new VirtualTextureResource(this.#gl, manifest, {
      pageSource: createManifestPageSource(manifest, manifestUri),
    });
  }
}

const entryStatus = (entry: VirtualTextureCacheEntry): VirtualTextureCacheEntryStatus => entry.kind;

const errorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
);

const resolveVirtualTextureUri = (uri: string): string =>
  new URL(uri, globalThis.location?.href ?? "http://localhost/").href;

const virtualTextureCacheEntryStats = (entry: VirtualTextureCacheEntry): VirtualTextureCacheEntryStats => ({
  error: entry.kind === "error" ? errorMessage(entry.error) : null,
  manifestUri: entry.descriptor.manifestUri,
  resource: entry.kind === "ready" ? entry.resource.stats() : null,
  ...(entry.descriptor.revision === undefined ? {} : { revision: entry.descriptor.revision }),
  status: entryStatus(entry),
});

const virtualTextureCacheKey = (descriptor: VirtualTextureCacheDescriptor): string => [
  descriptor.manifestUri,
  descriptor.revision ?? "",
].join("\u0000");

const virtualTextureCacheLoadResult = (entry: VirtualTextureCacheEntry): VirtualTextureCacheLoadResult => {
  const stats = virtualTextureCacheEntryStats(entry);
  switch (entry.kind) {
    case "error":
      return { error: entry.error, kind: "error", stats };
    case "loading":
      return { kind: "loading", stats };
    case "ready":
      return { kind: "ready", resource: entry.resource, stats };
  }
};

const withManifestPageBaseUri = (
  manifest: VirtualTextureManifest,
  manifestUri: string,
): VirtualTextureManifest => {
  if (manifest.pageSource.kind !== "uri") return manifest;
  return {
    ...manifest,
    pageSource: {
      ...manifest.pageSource,
      baseUri: new URL(manifest.pageSource.baseUri ?? "", manifestUri).href,
    },
  };
};

const createManifestPageSource = (
  manifest: VirtualTextureManifest,
  manifestUri: string,
): VirtualTexturePageSource => {
  if (manifest.pageSource.kind === "generated") {
    return createGeneratedVirtualTexturePageSource(manifest.pageSource);
  }

  return {
    async loadPage(request) {
      const pageUri = resolveVirtualTextureManifestPageUri(manifest, request.page);
      if (pageUri === null) {
        throw new Error(`Virtual texture manifest ${manifestUri} has no page source for ${request.pageId}`);
      }

      const pageResponse = await fetch(pageUri);
      if (!pageResponse.ok) {
        throw new Error(`Failed to load virtual texture page ${request.pageId} ${pageUri}: ${pageResponse.status}`);
      }
      return new Uint8Array(await pageResponse.arrayBuffer());
    },
  };
};
