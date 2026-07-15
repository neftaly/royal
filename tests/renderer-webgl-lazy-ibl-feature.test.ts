import { describe, expect, it, vi } from "vitest";
import type { DecodedTextureSourceLifetime } from "../packages/renderer-webgl/src/texture/decoded-source-lifetime";
import { LazyImageBasedLightingFeature } from "../packages/renderer-webgl/src/lazy-image-based-lighting-feature";
import {
  createResourceArena,
  disposeResourceArena,
  resourceArenaSourceReferenceCount,
} from "../packages/renderer-webgl/src/resource-arena";
import type { LoadedTextureSource } from "../packages/renderer-webgl/src/texture/sources";

describe("lazy image-based-lighting feature", () => {
  it("retains decoded glTF faces synchronously while its GPU module is unavailable", () => {
    const retain = vi.fn();
    const closeOrdinary = vi.fn();
    const resourceArena = createResourceArena(
      () => new Promise(() => undefined),
      () => undefined,
      { retain },
    );
    const feature = new LazyImageBasedLightingFeature({
      active: () => false,
      contextLifecycle: () => "lost",
      decodedTextureSources: { closeOrdinary } as unknown as DecodedTextureSourceLifetime,
      diagnostic: vi.fn(),
      disposed: () => false,
      gl: {} as WebGL2RenderingContext,
      governor: { reserve: () => undefined },
      invalidate: vi.fn(),
      resourceArena,
    });
    const specular = {
      encoding: "linear" as const,
      imageLoadKeys: [["face"]],
      imageSize: 4,
      key: "environment:test",
    };
    const first = { height: 4, width: 4 } as LoadedTextureSource;
    const replacement = { height: 4, width: 4 } as LoadedTextureSource;

    feature.settleSpecularImage(specular, "face", first);
    expect(retain).toHaveBeenCalledWith(first);
    expect(resourceArenaSourceReferenceCount(resourceArena, first)).toBe(1);

    feature.settleSpecularImage(specular, "face", replacement);
    expect(retain).toHaveBeenCalledWith(replacement);
    expect(resourceArenaSourceReferenceCount(resourceArena, first)).toBe(0);
    expect(resourceArenaSourceReferenceCount(resourceArena, replacement)).toBe(1);
    expect(closeOrdinary).toHaveBeenCalledWith(first);

    feature.releaseSpecular(specular.key);
    expect(disposeResourceArena(resourceArena).kind).toBe("disposed");
  });
});
