import { describe, expect, it, vi } from "vitest";
import {
  DecodedTextureSourceLifetime,
  decodedTextureSourceBytes,
} from "../packages/renderer-webgl/src/texture/decoded-source-lifetime";
import type { ResourceGovernorLease } from "../packages/renderer-webgl/src/resource-governor";
import type { LoadedTextureSource } from "../packages/renderer-webgl/src/texture/sources";

const decoded = (width = 2, height = 2): LoadedTextureSource => ({
  data: new Uint8Array(width * height * 4),
  height,
  kind: "rgba-texture",
  width,
});

const lease = (name: string, events: string[]): ResourceGovernorLease => {
  let released = false;
  return {
    release: () => {
      if (released) return false;
      released = true;
      events.push(`release:${name}`);
      return true;
    },
  };
};

describe("decoded texture source lifetime", () => {
  it("retains one ordinary lease and closes only after all shared arena references leave", () => {
    const events: string[] = [];
    const source = decoded();
    let references = 2;
    const reserve = vi.fn(() => lease("ordinary", events));
    const lifetime = new DecodedTextureSourceLifetime({
      closeOrdinary: () => events.push("close"),
      closeVirtualTexture: () => events.push("close-vt"),
      ordinaryReferenceCount: () => references,
      reserveOrdinaryDecodedBytes: reserve,
      scheduleRetry: vi.fn(),
    });

    lifetime.retainOrdinary(source);
    lifetime.retainOrdinary(source);
    lifetime.closeOrdinary(source);
    references = 1;
    lifetime.closeOrdinary(source);
    expect(events).toEqual([]);
    expect(reserve).toHaveBeenCalledOnce();
    expect(reserve).toHaveBeenCalledWith(16);

    references = 0;
    lifetime.closeOrdinary(source);
    lifetime.closeOrdinary(source);
    expect(events).toEqual(["close", "release:ordinary"]);
  });

  it("keeps the lease until a failed close succeeds on a later frame or disposal retry", () => {
    const events: string[] = [];
    const source = decoded();
    let attempts = 0;
    const lifetime = new DecodedTextureSourceLifetime({
      closeOrdinary: () => {
        events.push(`close:${++attempts}`);
        if (attempts === 1) throw new Error("busy");
      },
      ordinaryReferenceCount: () => 0,
      reserveOrdinaryDecodedBytes: () => lease("ordinary", events),
      scheduleRetry: vi.fn(),
    });
    lifetime.retainOrdinary(source);

    expect(() => lifetime.closeOrdinary(source)).toThrow("busy");
    expect(events).toEqual(["close:1"]);
    lifetime.retryPendingOrdinary();
    expect(events).toEqual(["close:1", "close:2", "release:ordinary"]);
    lifetime.retryPending();
    expect(events).toEqual(["close:1", "close:2", "release:ordinary"]);
  });

  it("retries ordinary and VT failures independently before a combined dispose retry", () => {
    const ordinary = decoded();
    const virtualTexture = decoded() as LoadedTextureSource & TexImageSource;
    const attempts = { ordinary: 0, virtualTexture: 0 };
    const lifetime = new DecodedTextureSourceLifetime({
      closeOrdinary: () => {
        attempts.ordinary += 1;
        if (attempts.ordinary < 2) throw new Error("ordinary busy");
      },
      closeVirtualTexture: () => {
        attempts.virtualTexture += 1;
        if (attempts.virtualTexture < 2) throw new Error("VT busy");
      },
      ordinaryReferenceCount: () => 0,
      reserveOrdinaryDecodedBytes: () => lease("ordinary", []),
      scheduleRetry: vi.fn(),
    });

    expect(() => lifetime.closeOrdinary(ordinary)).toThrow("ordinary busy");
    expect(() => lifetime.closeVirtualTexture(virtualTexture)).toThrow("VT busy");
    lifetime.retryPendingOrdinary();
    expect(attempts).toEqual({ ordinary: 2, virtualTexture: 1 });
    lifetime.retryPendingVirtualTexture();
    expect(attempts).toEqual({ ordinary: 2, virtualTexture: 2 });
    lifetime.retryPending();
    expect(attempts).toEqual({ ordinary: 2, virtualTexture: 2 });
  });

  it("retains a failed async VT close and schedules a renderer-owned retry", () => {
    const source = decoded() as LoadedTextureSource & TexImageSource;
    const scheduleRetry = vi.fn();
    let attempts = 0;
    const events: string[] = [];
    const lifetime = new DecodedTextureSourceLifetime({
      closeVirtualTexture: () => {
        attempts += 1;
        if (attempts === 1) throw new Error("busy");
        events.push("close");
      },
      ordinaryReferenceCount: () => 0,
      reserveOrdinaryDecodedBytes: () => lease("ordinary", events),
      scheduleRetry,
    });
    lifetime.retainVirtualTexture(source, lease("virtual-texture", events));

    lifetime.closeVirtualTextureAsync(source);
    expect(scheduleRetry).toHaveBeenCalledOnce();
    expect(events).toEqual([]);
    lifetime.retryPendingVirtualTexture();
    expect(events).toEqual(["close", "release:virtual-texture"]);
  });

  it("retains a page-owned VT closer across asynchronous retry", () => {
    const source = decoded() as LoadedTextureSource & TexImageSource;
    const scheduleRetry = vi.fn();
    const events: string[] = [];
    let attempts = 0;
    const lifetime = new DecodedTextureSourceLifetime({
      closeVirtualTexture: () => {
        throw new Error("default closer must not own this payload");
      },
      ordinaryReferenceCount: () => 0,
      reserveOrdinaryDecodedBytes: () => lease("ordinary", events),
      scheduleRetry,
    });
    lifetime.retainVirtualTexture(source, lease("page", events), () => {
      events.push(`close:${++attempts}`);
      if (attempts === 1) throw new Error("busy");
    });

    lifetime.closeVirtualTextureAsync(source);
    expect(scheduleRetry).toHaveBeenCalledOnce();
    lifetime.retryPendingVirtualTexture();
    expect(events).toEqual(["close:1", "close:2", "release:page"]);
  });

  it("releases a duplicate VT settlement lease without replacing the owner", () => {
    const source = decoded() as LoadedTextureSource & TexImageSource;
    const events: string[] = [];
    const lifetime = new DecodedTextureSourceLifetime({
      closeVirtualTexture: () => events.push("close"),
      ordinaryReferenceCount: () => 0,
      reserveOrdinaryDecodedBytes: () => lease("ordinary", events),
      scheduleRetry: vi.fn(),
    });
    lifetime.retainVirtualTexture(source, lease("owner", events));
    lifetime.retainVirtualTexture(source, lease("duplicate", events));
    expect(events).toEqual(["release:duplicate"]);
    lifetime.closeVirtualTexture(source);
    expect(events).toEqual(["release:duplicate", "close", "release:owner"]);
  });

  it("preserves close-once and release-after-close over varied retry counts", () => {
    for (let failures = 0; failures < 32; failures += 1) {
      const events: string[] = [];
      const source = decoded(1 + (failures % 5), 1 + (failures % 7));
      let attempts = 0;
      const lifetime = new DecodedTextureSourceLifetime({
        closeOrdinary: () => {
          events.push("close");
          attempts += 1;
          if (attempts <= failures) throw new Error("retry");
        },
        ordinaryReferenceCount: () => 0,
        reserveOrdinaryDecodedBytes: () => lease("ordinary", events),
        scheduleRetry: vi.fn(),
      });
      lifetime.retainOrdinary(source);
      try {
        lifetime.closeOrdinary(source);
      } catch {
        // Expected until the configured close failure count is exhausted.
      }
      for (let retry = 0; retry < failures; retry += 1) {
        try {
          lifetime.retryPending();
        } catch {
          // Expected until the configured close failure count is exhausted.
        }
      }
      lifetime.retryPending();
      lifetime.closeOrdinary(source);
      expect(events.filter((event) => event === "release:ordinary")).toHaveLength(1);
      expect(events.at(-1)).toBe("release:ordinary");
      expect(attempts).toBe(failures + 1);
    }
  });

  it("calculates decoded byte ownership without unsafe integer overflow", () => {
    expect(decodedTextureSourceBytes(decoded(3, 5))).toBe(60);
    const base = decoded(2, 2);
    if (!("data" in base)) throw new Error("expected decoded RGBA fixture");
    expect(decodedTextureSourceBytes({
      ...base,
      levels: [
        { data: base.data, height: 2, width: 2 },
        { data: new Uint8Array(4), height: 1, width: 1 },
      ],
    })).toBe(20);
    const oversized = { height: Number.MAX_SAFE_INTEGER, width: 2 } as unknown as LoadedTextureSource;
    expect(() => decodedTextureSourceBytes(oversized)).toThrow(RangeError);
  });
});
