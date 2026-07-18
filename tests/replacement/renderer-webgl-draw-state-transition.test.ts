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
  cullBackFaces: null,
  fixedOpaquePipelineKnown: false,
  frontFace: null,
  program: null,
  sampler0: null,
  texture0: null,
  textureBindingsKnown: false,
  vertexArray: null,
});

const intent = (): OpaqueDrawStateIntent => ({
  cullBackFaces: true,
  framebuffer: null,
  frontFace: 0x0901,
  program: handle<WebGLProgram>(),
  sampler0: null,
  texture0: null,
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
      cullMode: true,
      fixedPipeline: true,
      framebuffer: true,
      frontFace: true,
      program: true,
      sampler0: true,
      texture0: true,
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
      cullMode: false,
      fixedPipeline: false,
      framebuffer: false,
      frontFace: false,
      program: false,
      sampler0: false,
      texture0: false,
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

  it("isolates double-sided culling changes from the rest of the pipeline", () => {
    const previous = state();
    const first = intent();
    commitAppliedOpaqueDrawState(previous, first);
    const transition = createOpaqueDrawStateTransition();
    planOpaqueDrawStateTransition(previous, { ...first, cullBackFaces: false }, transition);
    expect(transition.cullMode).toBe(true);
    expect(Object.entries(transition)
      .filter(([key]) => key !== "cullMode")
      .every(([, value]) => !value)).toBe(true);
  });

  it("isolates texture and sampler binding changes from fixed pipeline state", () => {
    const previous = state();
    const first = intent();
    commitAppliedOpaqueDrawState(previous, first);
    const transition = createOpaqueDrawStateTransition();
    planOpaqueDrawStateTransition(previous, {
      ...first,
      sampler0: handle<WebGLSampler>(),
      texture0: handle<WebGLTexture>(),
    }, transition);
    expect(transition.sampler0).toBe(true);
    expect(transition.texture0).toBe(true);
    expect(Object.entries(transition)
      .filter(([key]) => key !== "sampler0" && key !== "texture0")
      .every(([, value]) => !value)).toBe(true);
  });
});
