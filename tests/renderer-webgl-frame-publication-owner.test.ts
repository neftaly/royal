import { afterEach, describe, expect, it, vi } from "vitest";
import { WebGlFramePublicationOwner } from "../packages/renderer-webgl/src/frame/publication-owner";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WebGL frame publication owner", () => {
  it("separates frame advancement from completed-frame publication", () => {
    const owner = new WebGlFramePublicationOwner();
    const observed: number[] = [];
    owner.observeFrame((frame) => observed.push(frame));

    expect(observed).toEqual([0]);
    expect(owner.advance()).toBe(1);
    expect(observed).toEqual([0]);
    owner.publishFrame();
    expect(observed).toEqual([0, 1]);
  });

  it("serializes reentrant frames so every observer sees increasing frame order", () => {
    const owner = new WebGlFramePublicationOwner();
    const first: number[] = [];
    const second: number[] = [];
    owner.observeFrame((frame) => {
      first.push(frame);
      if (frame === 1) {
        owner.advance();
        owner.publishFrame();
      }
    });
    owner.observeFrame((frame) => second.push(frame));

    owner.advance();
    owner.publishFrame();

    expect(first).toEqual([0, 1, 2]);
    expect(second).toEqual([0, 1, 2]);
  });

  it("delivers a subscription created during publication exactly once for that frame", () => {
    const owner = new WebGlFramePublicationOwner();
    const late: number[] = [];
    owner.observeFrame((frame) => {
      if (frame === 1) owner.observeFrame((next) => late.push(next));
    });

    owner.advance();
    owner.publishFrame();
    owner.advance();
    owner.publishFrame();

    expect(late).toEqual([1, 2]);
  });

  it("isolates frame and failure observers while preserving serialized failures", () => {
    const owner = new WebGlFramePublicationOwner();
    const firstFrameFailure = new Error("first frame observer failed");
    const secondFrameFailure = new Error("second frame observer failed");
    const failureObserverFailure = new Error("failure observer failed");
    const failures: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    owner.observeRenderFailures((failure) => {
      if (failure === firstFrameFailure) owner.reportRenderFailure("nested failure");
      throw failureObserverFailure;
    });
    owner.observeRenderFailures((failure) => failures.push(failure));
    owner.observeFrame((frame) => {
      if (frame > 0) throw firstFrameFailure;
    });
    owner.observeFrame((frame) => {
      if (frame > 0) throw secondFrameFailure;
    });

    owner.advance();
    expect(() => owner.publishFrame()).not.toThrow();

    expect(failures).toEqual([firstFrameFailure, "nested failure"]);
    expect(failures).not.toContain(secondFrameFailure);
    expect(consoleError).toHaveBeenCalledWith(
      "Royal WebGL render failure observer failed",
      failureObserverFailure,
    );
  });

  it("keeps immediate callback errors synchronous and makes disposal terminal", () => {
    const owner = new WebGlFramePublicationOwner();
    const immediateFailure = new Error("immediate observer failed");
    expect(() => owner.observeFrame(() => { throw immediateFailure; })).toThrow(immediateFailure);

    owner.advance();
    owner.publishFrame();
    owner.dispose();
    const finalFrames: number[] = [];
    owner.observeFrame((frame) => finalFrames.push(frame));
    expect(owner.advance()).toBe(1);
    owner.publishFrame();
    owner.reportRenderFailure(new Error("ignored"));

    expect(finalFrames).toEqual([1]);
  });
});
