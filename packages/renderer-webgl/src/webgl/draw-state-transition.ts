import type { AppliedClearState } from "./clear-state-transition";

export type OpaqueDrawStateIntent = Readonly<{
  framebuffer: WebGLFramebuffer | null;
  cullBackFaces: boolean;
  frontFace: number;
  program: WebGLProgram;
  samplers: readonly (WebGLSampler | null)[];
  textureUnits: number;
  textures: readonly (WebGLTexture | null)[];
  vertexArray: WebGLVertexArrayObject;
  viewport: Readonly<{ height: number; width: number; x: number; y: number }>;
}>;

export type OpaqueDrawStateTransition = {
  fixedPipeline: boolean;
  cullMode: boolean;
  framebuffer: boolean;
  frontFace: boolean;
  program: boolean;
  textureUnits: number;
  vertexArray: boolean;
  viewport: boolean;
  writeMasks: boolean;
};

export type AppliedOpaqueDrawState = AppliedClearState & {
  fixedOpaquePipelineKnown: boolean;
  cullBackFaces: boolean | null;
  frontFace: number | null;
  program: WebGLProgram | null;
  samplers: (WebGLSampler | null)[];
  textures: (WebGLTexture | null)[];
  textureBindingsKnown: boolean;
  vertexArray: WebGLVertexArrayObject | null;
};

export const createOpaqueDrawStateTransition = (): OpaqueDrawStateTransition => ({
  cullMode: false,
  fixedPipeline: false,
  framebuffer: false,
  frontFace: false,
  program: false,
  textureUnits: 0,
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
  output.cullMode = unknown
    || !previous.fixedOpaquePipelineKnown
    || previous.cullBackFaces !== next.cullBackFaces;
  output.frontFace = unknown || previous.frontFace !== next.frontFace;
  output.writeMasks = unknown || !previous.writeMasksKnown;
  output.program = unknown || previous.program !== next.program;
  output.textureUnits = 0;
  let remainingUnits = next.textureUnits;
  for (let unit = 0; remainingUnits !== 0; unit += 1, remainingUnits >>>= 1) {
    if ((remainingUnits & 1) === 0) continue;
    if (
      unknown
      || !previous.textureBindingsKnown
      || previous.textures[unit] !== next.textures[unit]
      || previous.samplers[unit] !== next.samplers[unit]
    ) output.textureUnits |= 1 << unit;
  }
  output.vertexArray = unknown || previous.vertexArray !== next.vertexArray;
};

export const commitAppliedOpaqueDrawState = (
  state: AppliedOpaqueDrawState,
  intent: OpaqueDrawStateIntent,
): void => {
  state.fixedOpaquePipelineKnown = true;
  state.cullBackFaces = intent.cullBackFaces;
  state.framebuffer = intent.framebuffer;
  state.frontFace = intent.frontFace;
  state.known = true;
  state.program = intent.program;
  let remainingUnits = intent.textureUnits;
  for (let unit = 0; remainingUnits !== 0; unit += 1, remainingUnits >>>= 1) {
    if ((remainingUnits & 1) === 0) continue;
    state.samplers[unit] = intent.samplers[unit] ?? null;
    state.textures[unit] = intent.textures[unit] ?? null;
  }
  state.scissorEnabled = false;
  state.vertexArray = intent.vertexArray;
  state.textureBindingsKnown = true;
  state.viewportHeight = intent.viewport.height;
  state.viewportWidth = intent.viewport.width;
  state.viewportX = intent.viewport.x;
  state.viewportY = intent.viewport.y;
  state.writeMasksKnown = true;
};
