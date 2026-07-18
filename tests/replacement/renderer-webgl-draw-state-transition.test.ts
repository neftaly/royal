import { describe, expect, it } from "vitest";
import {
  commitAppliedOpaqueDrawState,
  createOpaqueDrawStateTransition,
  planOpaqueDrawStateTransition,
  type AppliedOpaqueDrawState,
  type OpaqueDrawStateIntent,
} from "../../packages/renderer-webgl/src/webgl/draw-state-transition";
import { createUnknownClearState } from "../../packages/renderer-webgl/src/webgl/clear-state-transition";

const handle = <Value>(): Value => ({}) as Value;

const state = (): AppliedOpaqueDrawState => ({
  ...createUnknownClearState(),
  fixedOpaquePipelineKnown: false,
  frontFace: null,
  program: null,
  vertexArray: null,
});

const intent = (): OpaqueDrawStateIntent => ({
  framebuffer: null,
  frontFace: 0x0901,
  program: handle<WebGLProgram>(),
  vertexArray: handle<WebGLVertexArrayObject>(),
  viewport: { height: 360, width: 640, x: 0, y: 0 },
});

describe("opaque draw state transition core", () => {
  it("establishes every required state once, then suppresses an identical draw", () => {
    const previous = state();
    const next = intent();
    const transition = createOpaqueDrawStateTransition();
    planOpaqueDrawStateTransition(previous, next, transition);
    expect(transition).toEqual({
      fixedPipeline: true,
      framebuffer: true,
      frontFace: true,
      program: true,
      vertexArray: true,
      viewport: true,
      writeMasks: true,
    });
    commitAppliedOpaqueDrawState(previous, next);
    planOpaqueDrawStateTransition(previous, next, transition);
    expect(Object.values(transition).every((value) => !value)).toBe(true);
  });

  it("isolates a VAO change from unrelated WebGL state", () => {
    const previous = state();
    const first = intent();
    commitAppliedOpaqueDrawState(previous, first);
    const next = { ...first, vertexArray: handle<WebGLVertexArrayObject>() };
    const transition = createOpaqueDrawStateTransition();
    planOpaqueDrawStateTransition(previous, next, transition);
    expect(transition).toEqual({
      fixedPipeline: false,
      framebuffer: false,
      frontFace: false,
      program: false,
      vertexArray: true,
      viewport: false,
      writeMasks: false,
    });
  });

  it("isolates mirrored-front-face changes from the rest of the pipeline", () => {
    const previous = state();
    const first = intent();
    commitAppliedOpaqueDrawState(previous, first);
    const transition = createOpaqueDrawStateTransition();
    planOpaqueDrawStateTransition(previous, { ...first, frontFace: 0x0900 }, transition);
    expect(transition.frontFace).toBe(true);
    expect(Object.entries(transition)
      .filter(([key]) => key !== "frontFace")
      .every(([, value]) => !value)).toBe(true);
  });
});
