import type { AppliedClearState } from './clear-state-transition';

export type TextureUnitBinding = Readonly<{
  sampler: WebGLSampler | null;
  target: '2d' | 'cube';
  texture: WebGLTexture | null;
}>;

export type SurfaceDrawFrame = Readonly<{
  framebuffer: WebGLFramebuffer | null;
  viewport: Readonly<{ height: number; width: number; x: number; y: number }>;
}>;

export type SurfaceDrawPacket = Readonly<{
  alphaBlend: boolean;
  cullBackFaces: boolean;
  depthTest: boolean;
  depthWrite: boolean;
  frontFace: number;
  program: WebGLProgram;
  textureBindings: readonly TextureUnitBinding[];
  textureUnits: number;
  vertexArray: WebGLVertexArrayObject;
}>;

export type MutableSurfaceDrawFrame = {
  framebuffer: WebGLFramebuffer | null;
  viewport: Readonly<{ height: number; width: number; x: number; y: number }>;
};

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
  frame: SurfaceDrawFrame,
  packet: SurfaceDrawPacket,
  output: SurfaceDrawStateTransition,
): void => {
  const unknown = !previous.known;
  output.framebuffer = unknown || previous.framebuffer !== frame.framebuffer;
  output.viewport = unknown
    || previous.viewportX !== frame.viewport.x
    || previous.viewportY !== frame.viewport.y
    || previous.viewportWidth !== frame.viewport.width
    || previous.viewportHeight !== frame.viewport.height;
  output.fixedPipeline = unknown
    || !previous.fixedPipelineKnown
    || previous.scissorEnabled
    || previous.alphaBlend !== packet.alphaBlend
    || previous.depthTest !== packet.depthTest;
  output.cullMode = unknown
    || !previous.fixedPipelineKnown
    || previous.cullBackFaces !== packet.cullBackFaces;
  output.frontFace = unknown || previous.frontFace !== packet.frontFace;
  output.writeMasks = unknown
    || !previous.writeMasksKnown
    || previous.depthWrite !== packet.depthWrite;
  output.program = unknown || previous.program !== packet.program;
  output.textureUnits = 0;
  let remainingUnits = packet.textureUnits;
  for (let unit = 0; remainingUnits !== 0; unit += 1, remainingUnits >>>= 1) {
    if ((remainingUnits & 1) === 0) continue;
    if (
      unknown
      || previous.textureBindings[unit] !== packet.textureBindings[unit]
    ) output.textureUnits |= 1 << unit;
  }
  output.vertexArray = unknown || previous.vertexArray !== packet.vertexArray;
};

export const commitAppliedSurfaceDrawState = (
  state: AppliedSurfaceDrawState,
  frame: SurfaceDrawFrame,
  packet: SurfaceDrawPacket,
): void => {
  state.alphaBlend = packet.alphaBlend;
  state.cullBackFaces = packet.cullBackFaces;
  state.depthTest = packet.depthTest;
  state.depthWrite = packet.depthWrite;
  state.fixedPipelineKnown = true;
  state.framebuffer = frame.framebuffer;
  state.frontFace = packet.frontFace;
  state.known = true;
  state.program = packet.program;
  let remainingUnits = packet.textureUnits;
  for (let unit = 0; remainingUnits !== 0; unit += 1, remainingUnits >>>= 1) {
    if ((remainingUnits & 1) === 0) continue;
    state.textureBindings[unit] = packet.textureBindings[unit];
  }
  state.scissorEnabled = false;
  state.vertexArray = packet.vertexArray;
  state.viewportHeight = frame.viewport.height;
  state.viewportWidth = frame.viewport.width;
  state.viewportX = frame.viewport.x;
  state.viewportY = frame.viewport.y;
  state.writeMasksKnown = true;
};
