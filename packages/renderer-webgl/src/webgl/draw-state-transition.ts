import type { AppliedClearState } from './clear-state-transition';

export type TextureUnitBinding = Readonly<{
  sampler: WebGLSampler | null;
  target: '2d' | 'cube';
  texture: WebGLTexture | null;
}>;

export type SurfaceDrawStateIntent = Readonly<{
  alphaBlend: boolean;
  cullBackFaces: boolean;
  depthTest: boolean;
  depthWrite: boolean;
  framebuffer: WebGLFramebuffer | null;
  frontFace: number;
  program: WebGLProgram;
  textureBindings: readonly TextureUnitBinding[];
  textureUnits: number;
  vertexArray: WebGLVertexArrayObject;
  viewport: Readonly<{ height: number; width: number; x: number; y: number }>;
}>;

export type SurfaceDrawStateTransition = {
  cullMode: boolean;
  fixedPipeline: boolean;
  framebuffer: boolean;
  frontFace: boolean;
  program: boolean;
  textureUnits: number;
  vertexArray: boolean;
  viewport: boolean;
  writeMasks: boolean;
};

export type AppliedSurfaceDrawState = AppliedClearState & {
  alphaBlend: boolean | null;
  cullBackFaces: boolean | null;
  depthTest: boolean | null;
  depthWrite: boolean | null;
  fixedPipelineKnown: boolean;
  frontFace: number | null;
  program: WebGLProgram | null;
  textureBindings: (TextureUnitBinding | undefined)[];
  textureBindingsKnown: boolean;
  vertexArray: WebGLVertexArrayObject | null;
};

export const createSurfaceDrawStateTransition = (): SurfaceDrawStateTransition => ({
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

/** Plans one complete surface draw-state diff into caller-owned storage. */
export const planSurfaceDrawStateTransition = (
  previous: AppliedSurfaceDrawState,
  next: SurfaceDrawStateIntent,
  output: SurfaceDrawStateTransition,
): void => {
  const unknown = !previous.known;
  output.framebuffer = unknown || previous.framebuffer !== next.framebuffer;
  output.viewport = unknown
    || previous.viewportX !== next.viewport.x
    || previous.viewportY !== next.viewport.y
    || previous.viewportWidth !== next.viewport.width
    || previous.viewportHeight !== next.viewport.height;
  output.fixedPipeline = unknown
    || !previous.fixedPipelineKnown
    || previous.scissorEnabled
    || previous.alphaBlend !== next.alphaBlend
    || previous.depthTest !== next.depthTest;
  output.cullMode = unknown
    || !previous.fixedPipelineKnown
    || previous.cullBackFaces !== next.cullBackFaces;
  output.frontFace = unknown || previous.frontFace !== next.frontFace;
  output.writeMasks = unknown
    || !previous.writeMasksKnown
    || previous.depthWrite !== next.depthWrite;
  output.program = unknown || previous.program !== next.program;
  output.textureUnits = 0;
  let remainingUnits = next.textureUnits;
  for (let unit = 0; remainingUnits !== 0; unit += 1, remainingUnits >>>= 1) {
    if ((remainingUnits & 1) === 0) continue;
    if (
      unknown
      || !previous.textureBindingsKnown
      || previous.textureBindings[unit] !== next.textureBindings[unit]
    ) output.textureUnits |= 1 << unit;
  }
  output.vertexArray = unknown || previous.vertexArray !== next.vertexArray;
};

export const commitAppliedSurfaceDrawState = (
  state: AppliedSurfaceDrawState,
  intent: SurfaceDrawStateIntent,
): void => {
  state.alphaBlend = intent.alphaBlend;
  state.cullBackFaces = intent.cullBackFaces;
  state.depthTest = intent.depthTest;
  state.depthWrite = intent.depthWrite;
  state.fixedPipelineKnown = true;
  state.framebuffer = intent.framebuffer;
  state.frontFace = intent.frontFace;
  state.known = true;
  state.program = intent.program;
  let remainingUnits = intent.textureUnits;
  for (let unit = 0; remainingUnits !== 0; unit += 1, remainingUnits >>>= 1) {
    if ((remainingUnits & 1) === 0) continue;
    state.textureBindings[unit] = intent.textureBindings[unit];
  }
  state.scissorEnabled = false;
  state.textureBindingsKnown = true;
  state.vertexArray = intent.vertexArray;
  state.viewportHeight = intent.viewport.height;
  state.viewportWidth = intent.viewport.width;
  state.viewportX = intent.viewport.x;
  state.viewportY = intent.viewport.y;
  state.writeMasksKnown = true;
};
