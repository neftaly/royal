import { describe, expect, it } from "vitest";
import type { ClearFrameIntent } from "../../packages/renderer-webgl/src/frame/clear-frame";
import { validateClearFrameIntent } from "../../packages/renderer-webgl/src/frame/clear-frame";
import {
  commitAppliedClearState,
  createClearStateTransition,
  createUnknownClearState,
  planClearStateTransition,
} from "../../packages/renderer-webgl/src/webgl/clear-state-transition";

const frame = (overrides: Partial<ClearFrameIntent> = {}): ClearFrameIntent => ({
  clearColor: [0.1, 0.2, 0.3, 1],
  clearDepth: 1,
  framebuffer: null,
  scissor: null,
  size: { height: 360, width: 640 },
  viewport: { height: 360, width: 640, x: 0, y: 0 },
  ...overrides,
});

describe("clear frame intent", () => {
  it("accepts a complete in-bounds frame", () => {
    expect(() => validateClearFrameIntent(frame())).not.toThrow();
  });

  it("rejects invalid dimensions, color and clipping", () => {
    expect(() => validateClearFrameIntent(frame({
      size: { height: 360, width: 0 },
    }))).toThrow(RangeError);
    expect(() => validateClearFrameIntent(frame({
      clearColor: [0, Number.NaN, 0, 1],
    }))).toThrow(TypeError);
    expect(() => validateClearFrameIntent(frame({
      scissor: { height: 20, width: 20, x: 630, y: 0 },
    }))).toThrow(RangeError);
  });
});

describe("clear WebGL state transition", () => {
  it("plans every semantic transition from unknown state", () => {
    const output = createClearStateTransition();
    planClearStateTransition(createUnknownClearState(), frame(), output);
    expect(output).toEqual({
      clearColor: true,
      clearDepth: true,
      colorMask: true,
      framebuffer: true,
      scissorMode: true,
      scissorRectangle: false,
      viewport: true,
    });
  });

  it("emits no semantic state writes for the same complete intent", () => {
    const state = createUnknownClearState();
    const intent = frame();
    commitAppliedClearState(state, intent);
    const output = createClearStateTransition();
    planClearStateTransition(state, frame(), output);
    expect(output).toEqual({
      clearColor: false,
      clearDepth: false,
      colorMask: false,
      framebuffer: false,
      scissorMode: false,
      scissorRectangle: false,
      viewport: false,
    });
  });

  it("distinguishes scissor enablement from rectangle changes", () => {
    const state = createUnknownClearState();
    commitAppliedClearState(state, frame());
    const output = createClearStateTransition();
    const scissor = { height: 80, width: 100, x: 10, y: 20 };
    planClearStateTransition(state, frame({ scissor }), output);
    expect(output.scissorMode).toBe(true);
    expect(output.scissorRectangle).toBe(true);

    commitAppliedClearState(state, frame({ scissor }));
    planClearStateTransition(state, frame({
      scissor: { ...scissor, width: 90 },
    }), output);
    expect(output.scissorMode).toBe(false);
    expect(output.scissorRectangle).toBe(true);
  });
});
