import { afterEach, describe, expect, it, vi } from "vitest";
import { prefilteredEnvironment } from "@royal/renderer-core";
import {
  PrefilteredEnvironmentOwner,
  prefilteredEnvironmentKey,
} from "../packages/renderer-webgl/src/environment/prefiltered-environment-owner";
import { createIblTextureArena } from "../packages/renderer-webgl/src/webgl/ibl-texture-arena";

const arena = () => createIblTextureArena({
  MAX_TEXTURE_IMAGE_UNITS: 0x8872,
  getParameter: () => 16,
} as unknown as WebGL2RenderingContext);

afterEach(() => vi.unstubAllGlobals());

describe("PrefilteredEnvironmentOwner", () => {
  it("gives source versions type-stable cache identity", () => {
    expect(prefilteredEnvironmentKey(prefilteredEnvironment({ src: "/env.ktx", version: 1 })))
      .not.toBe(prefilteredEnvironmentKey(prefilteredEnvironment({ src: "/env.ktx", version: "1" })));
  });

  it("aborts replaced transport and reports strict artifact failures once", async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const requests: Array<{ readonly init?: RequestInit; readonly src: string }> = [];
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const src = String(input);
      requests.push({ ...(init === undefined ? {} : { init }), src });
      if (src === "/first.ktx") return first;
      return Promise.resolve({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response);
    }));
    const diagnostic = vi.fn();
    const invalidate = vi.fn();
    const owner = new PrefilteredEnvironmentOwner({
      diagnostic,
      invalidate,
      textures: arena(),
    });

    expect(owner.resolve(prefilteredEnvironment({ src: "/first.ktx" }))).toBeUndefined();
    expect(owner.resolve(prefilteredEnvironment({ src: "/second.ktx" }))).toBeUndefined();
    expect(requests[0]?.init?.signal?.aborted).toBe(true);
    await vi.waitFor(() => expect(diagnostic).toHaveBeenCalledOnce());
    expect(diagnostic.mock.calls[0]?.[0]).toMatch(/truncated/);
    expect(invalidate).toHaveBeenCalledOnce();

    owner.release();
    expect(requests[1]?.init?.signal?.aborted).toBe(true);
    resolveFirst?.({ ok: false } as Response);
  });
});
