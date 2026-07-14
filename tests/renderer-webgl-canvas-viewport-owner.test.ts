import { afterEach, describe, expect, it, vi } from "vitest";
import { WebGlCanvasViewportOwner } from "../packages/renderer-webgl/src/canvas-viewport-owner";

type MutableCanvas = HTMLCanvasElement & {
  setCssSize(width: number, height: number): void;
};

const mutableCanvas = (initialWidth = 320, initialHeight = 180): MutableCanvas => {
  let width = initialWidth;
  let height = initialHeight;
  return {
    height: 0,
    width: 0,
    getBoundingClientRect: () => ({ height, width }) as DOMRect,
    setCssSize: (nextWidth: number, nextHeight: number) => {
      width = nextWidth;
      height = nextHeight;
    },
  } as unknown as MutableCanvas;
};

type ControlledMediaQuery = MediaQueryList & {
  dispatchChange(): void;
  readonly listenerCount: number;
};

const controlledMediaQuery = (media: string): ControlledMediaQuery => {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const query = {
    addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.add(listener);
    }),
    addListener: vi.fn(),
    dispatchChange: () => {
      const event = new Event("change");
      for (const listener of Array.from(listeners)) {
        if (typeof listener === "function") listener.call(query, event);
        else listener.handleEvent(event);
      }
    },
    dispatchEvent: vi.fn(() => true),
    get listenerCount() {
      return listeners.size;
    },
    matches: true,
    media,
    onchange: null,
    removeEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.delete(listener);
    }),
    removeListener: vi.fn(),
  };
  return query as unknown as ControlledMediaQuery;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WebGL canvas viewport owner", () => {
  it("sizes the backing store from CSS pixels and the current DPR", () => {
    const canvas = mutableCanvas();
    const owner = new WebGlCanvasViewportOwner(canvas, () => undefined);
    vi.stubGlobal("devicePixelRatio", 2);

    expect(owner.size()).toEqual({ height: 360, width: 640 });
    expect([canvas.width, canvas.height]).toEqual([640, 360]);

    canvas.setCssSize(240, 120);
    vi.stubGlobal("devicePixelRatio", 1.5);
    expect(owner.size()).toEqual({ height: 180, width: 360 });

    canvas.setCssSize(0, 0);
    expect(owner.size()).toEqual({ height: 1, width: 1 });
  });

  it("observes CSS size and rebinds the DPR query before invalidating", () => {
    const canvas = mutableCanvas();
    const invalidations: string[] = [];
    let resizeCallback: ResizeObserverCallback | undefined;
    const disconnect = vi.fn();
    const observe = vi.fn();
    class ControlledResizeObserver implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      disconnect = disconnect;
      observe = observe;
      takeRecords = vi.fn((): ResizeObserverEntry[] => []);
      unobserve = vi.fn();
    }
    const queries: ControlledMediaQuery[] = [];
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal("ResizeObserver", ControlledResizeObserver);
    vi.stubGlobal("matchMedia", vi.fn((media: string) => {
      const query = controlledMediaQuery(media);
      queries.push(query);
      return query;
    }));
    const owner = new WebGlCanvasViewportOwner(canvas, () => {
      invalidations.push(queries.at(-1)?.media ?? "resize");
    });

    owner.start();
    owner.start();
    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith(canvas);
    expect(queries.map((query) => query.media)).toEqual(["(resolution: 1dppx)"]);

    resizeCallback?.([], {} as ResizeObserver);
    vi.stubGlobal("devicePixelRatio", 2);
    queries[0]!.dispatchChange();

    expect(queries.map((query) => query.media)).toEqual([
      "(resolution: 1dppx)",
      "(resolution: 2dppx)",
    ]);
    expect(queries[0]!.listenerCount).toBe(0);
    expect(queries[1]!.listenerCount).toBe(1);
    expect(invalidations).toEqual(["(resolution: 1dppx)", "(resolution: 2dppx)"]);

    owner.dispose();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(queries[1]!.listenerCount).toBe(0);
    resizeCallback?.([], {} as ResizeObserver);
    queries[1]!.dispatchChange();
    expect(invalidations).toHaveLength(2);
    expect(() => owner.start()).toThrow("disposed Royal canvas viewport owner");
  });

  it("works without optional viewport observation APIs", () => {
    const owner = new WebGlCanvasViewportOwner(mutableCanvas(), () => undefined);
    vi.stubGlobal("ResizeObserver", undefined);
    vi.stubGlobal("matchMedia", undefined);

    expect(() => owner.start()).not.toThrow();
    expect(() => owner.dispose()).not.toThrow();
    expect(() => owner.dispose()).not.toThrow();
  });

  it("cleans every partial-start resource without masking cleanup order", () => {
    const canvas = mutableCanvas();
    const primaryFailure = new Error("listener registration failed");
    const disconnectFailure = new Error("resize disconnect failed");
    const listeners = new Set<EventListenerOrEventListenerObject>();
    const disconnect = vi.fn(() => { throw disconnectFailure; });
    class ThrowingResizeObserver implements ResizeObserver {
      disconnect = disconnect;
      observe = vi.fn();
      takeRecords = vi.fn((): ResizeObserverEntry[] => []);
      unobserve = vi.fn();
    }
    const removeEventListener = vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.delete(listener);
    });
    vi.stubGlobal("ResizeObserver", ThrowingResizeObserver);
    vi.stubGlobal("matchMedia", vi.fn((media: string) => ({
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.add(listener);
        throw primaryFailure;
      },
      addListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
      matches: true,
      media,
      onchange: null,
      removeEventListener,
      removeListener: vi.fn(),
    }) satisfies MediaQueryList));
    const owner = new WebGlCanvasViewportOwner(canvas, () => undefined);

    expect(() => owner.start()).toThrow(primaryFailure);
    expect(() => owner.dispose()).toThrow(disconnectFailure);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(removeEventListener).toHaveBeenCalledTimes(1);
    expect(listeners).toHaveLength(0);
  });
});
