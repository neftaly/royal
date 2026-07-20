import { describe, expect, it } from "vitest";
import {
  commitAppliedSurfaceDrawState,
  createSurfaceDrawStateTransition,
  planSurfaceDrawStateTransition,
  type AppliedSurfaceDrawState,
  type SurfaceDrawFrame,
  type SurfaceDrawPacket,
} from "../../packages/renderer-webgl/src/webgl/draw-state-transition";
import { createUnknownClearState } from "../../packages/renderer-webgl/src/webgl/clear-state-transition";

const handle = <Value>(): Value => ({}) as Value;

const state = (): AppliedSurfaceDrawState => ({
  ...createUnknownClearState(),
  alphaBlend: null,
  cullBackFaces: null,
  depthTest: null,
  depthWrite: null,
  fixedPipelineKnown: false,
  frontFace: null,
  program: null,
  textureBindings: [],
  vertexArray: null,
});

const draw = (): Readonly<{ frame: SurfaceDrawFrame; packet: SurfaceDrawPacket }> => ({
  frame: {
    framebuffer: null,
    viewport: { height: 360, width: 640, x: 0, y: 0 },
  },
  packet: {
    alphaBlend: false,
    cullBackFaces: true,
    depthTest: true,
    depthWrite: true,
    frontFace: 0x0901,
    program: handle<WebGLProgram>(),
    textureBindings: [{ sampler: null, target: "2d", texture: null }],
    textureUnits: 1,
    vertexArray: handle<WebGLVertexArrayObject>(),
  },
});

describe("surface draw state transition core", () => {
  it("establishes every required state once, then suppresses an identical draw", () => {
    const previous = state();
    const { frame, packet } = draw();
    const transition = createSurfaceDrawStateTransition();
    planSurfaceDrawStateTransition(previous, frame, packet, transition);
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
    commitAppliedSurfaceDrawState(previous, frame, packet);
    planSurfaceDrawStateTransition(previous, frame, packet, transition);
    expect(Object.values(transition).every((value) => !value)).toBe(true);
  });

  it("isolates a VAO change from unrelated WebGL state", () => {
    const previous = state();
    const { frame, packet } = draw();
    commitAppliedSurfaceDrawState(previous, frame, packet);
    const next = { ...packet, vertexArray: handle<WebGLVertexArrayObject>() };
    const transition = createSurfaceDrawStateTransition();
    planSurfaceDrawStateTransition(previous, frame, next, transition);
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
    const { frame, packet } = draw();
    commitAppliedSurfaceDrawState(previous, frame, packet);
    const transition = createSurfaceDrawStateTransition();
    planSurfaceDrawStateTransition(previous, frame, { ...packet, frontFace: 0x0900 }, transition);
    expect(transition.frontFace).toBe(true);
    expect(Object.entries(transition)
      .filter(([key]) => key !== "frontFace")
      .every(([, value]) => !value)).toBe(true);
  });

  it("isolates double-sided culling changes from the rest of the pipeline", () => {
    const previous = state();
    const { frame, packet } = draw();
    commitAppliedSurfaceDrawState(previous, frame, packet);
    const transition = createSurfaceDrawStateTransition();
    planSurfaceDrawStateTransition(previous, frame, { ...packet, cullBackFaces: false }, transition);
    expect(transition.cullMode).toBe(true);
    expect(Object.entries(transition)
      .filter(([key]) => key !== "cullMode")
      .every(([, value]) => !value)).toBe(true);
  });

  it("isolates texture and sampler binding changes from fixed pipeline state", () => {
    const previous = state();
    const { frame, packet } = draw();
    commitAppliedSurfaceDrawState(previous, frame, packet);
    const transition = createSurfaceDrawStateTransition();
    planSurfaceDrawStateTransition(previous, frame, {
      ...packet,
      textureBindings: [
        packet.textureBindings[0]!,
        { sampler: handle<WebGLSampler>(), target: "2d", texture: handle<WebGLTexture>() },
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
    const { frame, packet } = draw();
    const textured: SurfaceDrawPacket = {
      ...packet,
      textureBindings: [{
        sampler: handle<WebGLSampler>(),
        target: "2d",
        texture: handle<WebGLTexture>(),
      }],
    };
    commitAppliedSurfaceDrawState(previous, frame, textured);
    const untextured: SurfaceDrawPacket = {
      ...textured,
      textureBindings: [{ sampler: null, target: "2d", texture: null }],
      textureUnits: 0,
    };
    const transition = createSurfaceDrawStateTransition();
    planSurfaceDrawStateTransition(previous, frame, untextured, transition);
    expect(transition.textureUnits).toBe(0);
    commitAppliedSurfaceDrawState(previous, frame, untextured);
    expect(previous.textureBindings[0]).toBe(textured.textureBindings[0]);
  });

  it("does not let an untextured draw validate texture units dirtied by an upload", () => {
    const previous = state();
    const { frame, packet } = draw();
    const textured: SurfaceDrawPacket = {
      ...packet,
      textureBindings: [{
        sampler: handle<WebGLSampler>(),
        target: "2d",
        texture: handle<WebGLTexture>(),
      }],
    };
    commitAppliedSurfaceDrawState(previous, frame, textured);
    previous.textureBindings.length = 0;

    const untextured = { ...textured, textureUnits: 0 };
    const transition = createSurfaceDrawStateTransition();
    planSurfaceDrawStateTransition(previous, frame, untextured, transition);
    expect(transition.textureUnits).toBe(0);
    commitAppliedSurfaceDrawState(previous, frame, untextured);
    expect(previous.textureBindings).toEqual([]);

    planSurfaceDrawStateTransition(previous, frame, textured, transition);
    expect(transition.textureUnits).toBe(1);
  });

  it("keeps untouched texture units valid when one upload unit becomes unknown", () => {
    const previous = state();
    const { frame, packet } = draw();
    const bindings = [
      { sampler: handle<WebGLSampler>(), target: "2d" as const, texture: handle<WebGLTexture>() },
      { sampler: handle<WebGLSampler>(), target: "2d" as const, texture: handle<WebGLTexture>() },
    ];
    const textured = { ...packet, textureBindings: bindings, textureUnits: 3 };
    commitAppliedSurfaceDrawState(previous, frame, textured);
    previous.textureBindings[0] = undefined;

    const transition = createSurfaceDrawStateTransition();
    planSurfaceDrawStateTransition(previous, frame, textured, transition);
    expect(transition.textureUnits).toBe(1);
  });

  it("changes only blend/depth pipeline state when crossing the transparent boundary", () => {
    const previous = state();
    const { frame, packet: opaque } = draw();
    commitAppliedSurfaceDrawState(previous, frame, opaque);
    const transition = createSurfaceDrawStateTransition();
    planSurfaceDrawStateTransition(previous, frame, {
      ...opaque,
      alphaBlend: true,
      depthWrite: false,
    }, transition);
    expect(transition.fixedPipeline).toBe(true);
    expect(transition.writeMasks).toBe(true);
    expect(Object.entries(transition)
      .filter(([key]) => key !== "fixedPipeline" && key !== "writeMasks")
      .every(([, value]) => !value)).toBe(true);
  });

  it("represents a fullscreen pass without coupling depth behavior to blending", () => {
    const previous = state();
    const { frame, packet: opaque } = draw();
    commitAppliedSurfaceDrawState(previous, frame, opaque);
    const transition = createSurfaceDrawStateTransition();
    planSurfaceDrawStateTransition(previous, frame, {
      ...opaque,
      depthTest: false,
      depthWrite: false,
    }, transition);
    expect(transition.fixedPipeline).toBe(true);
    expect(transition.writeMasks).toBe(true);
  });
});
