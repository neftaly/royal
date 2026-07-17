import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canvasSizeFromCssBox,
  createCanvasSizeStore,
} from "../packages/react/src/canvas-size";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("React Canvas CSS size", () => {
  it("projects only positive finite boxes", () => {
    expect(canvasSizeFromCssBox(800, 400)).toEqual({
      aspectRatio: 2,
      height: 400,
      width: 800,
    });
    expect(canvasSizeFromCssBox(0, 400)).toBeUndefined();
    expect(canvasSizeFromCssBox(800, Number.NaN)).toBeUndefined();
  });

  it("shares one lazy ResizeObserver and suppresses unchanged publications", () => {
    let width = 800;
    let height = 400;
    let update: (() => void) | undefined;
    const disconnect = vi.fn();
    const observe = vi.fn();
    class ResizeObserverStub {
      constructor(callback: () => void) { update = callback; }
      disconnect(): void { disconnect(); }
      observe(target: Element): void { observe(target); }
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const canvas = {
      getBoundingClientRect: () => ({ height, width }),
    } as HTMLCanvasElement;
    const store = createCanvasSizeStore(canvas);
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = store.subscribe(first);
    const unsubscribeSecond = store.subscribe(second);

    expect(observe).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toEqual({ aspectRatio: 2, height: 400, width: 800 });
    update?.();
    expect(first).not.toHaveBeenCalled();
    width = 600;
    update?.();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toEqual({ aspectRatio: 1.5, height: 400, width: 600 });

    unsubscribeFirst();
    expect(disconnect).not.toHaveBeenCalled();
    unsubscribeSecond();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
