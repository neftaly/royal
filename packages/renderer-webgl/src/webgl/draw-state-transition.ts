import type { AppliedClearState } from "./clear-state-transition";

export type OpaqueDrawStateIntent = Readonly<{
  framebuffer: WebGLFramebuffer | null;
  frontFace: number;
  program: WebGLProgram;
  vertexArray: WebGLVertexArrayObject;
  viewport: Readonly<{ height: number; width: number; x: number; y: number }>;
}>;

export type OpaqueDrawStateTransition = {
  fixedPipeline: boolean;
  framebuffer: boolean;
  frontFace: boolean;
  program: boolean;
  vertexArray: boolean;
  viewport: boolean;
  writeMasks: boolean;
};

export type AppliedOpaqueDrawState = AppliedClearState & {
  fixedOpaquePipelineKnown: boolean;
  frontFace: number | null;
  program: WebGLProgram | null;
  vertexArray: WebGLVertexArrayObject | null;
};

export const createOpaqueDrawStateTransition = (): OpaqueDrawStateTransition => ({
  fixedPipeline: false,
  framebuffer: false,
  frontFace: false,
  program: false,
  vertexArray: false,
  viewport: false,
  writeMasks: false,
});

/** Plans the complete opaque draw state diff into caller-owned storage. */
export const planOpaqueDrawStateTransition = (
  previous: AppliedOpaqueDrawState,
  next: OpaqueDrawStateIntent,
  output: OpaqueDrawStateTransition,
): void => {
  const unknown = !previous.known;
  output.framebuffer = unknown || previous.framebuffer !== next.framebuffer;
  output.viewport = unknown
    || previous.viewportX !== next.viewport.x
    || previous.viewportY !== next.viewport.y
    || previous.viewportWidth !== next.viewport.width
    || previous.viewportHeight !== next.viewport.height;
  output.fixedPipeline = unknown || !previous.fixedOpaquePipelineKnown || previous.scissorEnabled;
  output.frontFace = unknown || previous.frontFace !== next.frontFace;
  output.writeMasks = unknown || !previous.writeMasksKnown;
  output.program = unknown || previous.program !== next.program;
  output.vertexArray = unknown || previous.vertexArray !== next.vertexArray;
};

export const commitAppliedOpaqueDrawState = (
  state: AppliedOpaqueDrawState,
  intent: OpaqueDrawStateIntent,
): void => {
  state.fixedOpaquePipelineKnown = true;
  state.framebuffer = intent.framebuffer;
  state.frontFace = intent.frontFace;
  state.known = true;
  state.program = intent.program;
  state.scissorEnabled = false;
  state.vertexArray = intent.vertexArray;
  state.viewportHeight = intent.viewport.height;
  state.viewportWidth = intent.viewport.width;
  state.viewportX = intent.viewport.x;
  state.viewportY = intent.viewport.y;
  state.writeMasksKnown = true;
};
