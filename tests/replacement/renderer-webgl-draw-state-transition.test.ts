import { describe, expect, it } from "vitest";
import {
  commitAppliedSurfaceDrawState,
  createSurfaceDrawStateTransition,
  planSurfaceDrawStateTransition,
  type AppliedSurfaceDrawState,
  type SurfaceDrawStateIntent,
} from "../../packages/renderer-webgl/src/webgl/draw-state-transition";
import { createUnknownClearState } from "../../packages/renderer-webgl/src/webgl/clear-state-transition";

const handle = <Value>(): Value => ({}) as Value;

const state = (): AppliedSurfaceDrawState => ({
  ...createUnknownClearState(),
  alphaBlend: null,
  cullBackFaces: null,
  fixedPipelineKnown: false,
  frontFace: null,
  program: null,
  textureBindings: [],
  textureBindingsKnown: false,
  vertexArray: null,
});

const intent = (): SurfaceDrawStateIntent => ({
  alphaBlend: false,
  cullBackFaces: true,
  framebuffer: null,
  frontFace: 0x0901,
  program: handle<WebGLProgram>(),
  textureBindings: [{ sampler: null, texture: null }],
  textureUnits: 1,
  vertexArray: handle<WebGLVertexArrayObject>(),
  viewport: { height: 360, width: 640, x: 0, y: 0 },
});

describe("surface draw state transition core", () => {
  it("establishes every required state once, then suppresses an identical draw", () => {
    const previous = state();
    const next = intent();
    const transition = createSurfaceDrawStateTransition();
    planSurfaceDrawStateTransition(previous, next, transition);
    expect(transition).toEqual({
      cullMode: true,
      fixedPipeline: true,
      framebuffer: true,
      frontFace: true,
      program: true,
      textureUnits: 1,
      vertexArray: true,
      viewport: true,
      writeMasks: true,
    });
    commitAppliedSurfaceDrawState(previous, next);
    planSurfaceDrawStateTransition(previous, next, transition);
    expect(Object.values(transition).every((value) => !value)).toBe(true);
  });

  it("isolates a VAO change from unrelated WebGL state", () => {
    const previous = state();
    const first = intent();
    commitAppliedSurfaceDrawState(previous, first);
    const next = { ...first, vertexArray: handle<WebGLVertexArrayObject>() };
    const transition = createSurfaceDrawStateTransition();
    planSurfaceDrawStateTransition(previous, next, transition);
    expect(transition).toEqual({
      cullMode: false,
      fixedPipeline: false,
      framebuffer: false,
      frontFace: false,
      program: false,
      textureUnits: 0,
      vertexArray: true,
      viewport: false,
      writeMasks: false,
    });
  });

  it("isolates mirrored-front-face changes from the rest of the pipeline", () => {
    const previous = state();
    const first = intent();
    commitAppliedSurfaceDrawState(previous, first);
    const transition = createSurfaceDrawStateTransition();
    planSurfaceDrawStateTransition(previous, { ...first, frontFace: 0x0900 }, transition);
    expect(transition.frontFace).toBe(true);
    expect(Object.entries(transition)
      .filter(([key]) => key !== "frontFace")
      .every(([, value]) => !value)).toBe(true);
  });

  it("isolates double-sided culling changes from the rest of the pipeline", () => {
    const previous = state();
    const first = intent();
    commitAppliedSurfaceDrawState(previous, first);
    const transition = createSurfaceDrawStateTransition();
    planSurfaceDrawStateTransition(previous, { ...first, cullBackFaces: false }, transition);
    expect(transition.cullMode).toBe(true);
    expect(Object.entries(transition)
      .filter(([key]) => key !== "cullMode")
      .every(([, value]) => !value)).toBe(true);
  });

  it("isolates texture and sampler binding changes from fixed pipeline state", () => {
    const previous = state();
    const first = intent();
    commitAppliedSurfaceDrawState(previous, first);
    const transition = createSurfaceDrawStateTransition();
    planSurfaceDrawStateTransition(previous, {
      ...first,
      textureBindings: [
        first.textureBindings[0]!,
        { sampler: handle<WebGLSampler>(), texture: handle<WebGLTexture>() },
      ],
      textureUnits: 3,
    }, transition);
    expect(transition.textureUnits).toBe(2);
    expect(Object.entries(transition)
      .filter(([key]) => key !== "textureUnits")
      .every(([, value]) => !value)).toBe(true);
  });

  it("retains but does not inspect bindings unused by the next shader", () => {
    const previous = state();
    const textured = {
      ...intent(),
      textureBindings: [{
        sampler: handle<WebGLSampler>(),
        texture: handle<WebGLTexture>(),
      }],
    };
    commitAppliedSurfaceDrawState(previous, textured);
    const untextured = {
      ...textured,
      textureBindings: [{ sampler: null, texture: null }],
      textureUnits: 0,
    };
    const transition = createSurfaceDrawStateTransition();
    planSurfaceDrawStateTransition(previous, untextured, transition);
    expect(transition.textureUnits).toBe(0);
    commitAppliedSurfaceDrawState(previous, untextured);
    expect(previous.textureBindings[0]).toBe(textured.textureBindings[0]);
  });

  it("changes only blend/depth pipeline state when crossing the transparent boundary", () => {
    const previous = state();
    const opaque = intent();
    commitAppliedSurfaceDrawState(previous, opaque);
    const transition = createSurfaceDrawStateTransition();
    planSurfaceDrawStateTransition(previous, { ...opaque, alphaBlend: true }, transition);
    expect(transition.fixedPipeline).toBe(true);
    expect(transition.writeMasks).toBe(true);
    expect(Object.entries(transition)
      .filter(([key]) => key !== "fixedPipeline" && key !== "writeMasks")
      .every(([, value]) => !value)).toBe(true);
  });
});
