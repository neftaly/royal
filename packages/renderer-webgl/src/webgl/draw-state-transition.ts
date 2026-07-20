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
  blendFunction: boolean;
  blendMode: boolean;
  cullFace: boolean;
  cullMode: boolean;
  depthFunction: boolean;
  depthMode: boolean;
  depthWrite: boolean;
  framebuffer: boolean;
  frontFace: boolean;
  program: boolean;
  rasterDefaults: boolean;
  textureUnits: number;
  vertexArray: boolean;
  viewport: boolean;
  writeMasks: boolean;
};

export type AppliedSurfaceDrawState = AppliedClearState & {
  alphaBlend: boolean | null;
  blendFunctionKnown: boolean;
  cullFaceKnown: boolean;
  cullBackFaces: boolean | null;
  depthFunctionKnown: boolean;
  depthTest: boolean | null;
  depthWrite: boolean | null;
  frontFace: number | null;
  program: WebGLProgram | null;
  rasterDefaultsKnown: boolean;
  textureBindings: (TextureUnitBinding | undefined)[];
  vertexArray: WebGLVertexArrayObject | null;
};

export const createSurfaceDrawStateTransition = (): SurfaceDrawStateTransition => ({
  blendFunction: false,
  blendMode: false,
  cullFace: false,
  cullMode: false,
  depthFunction: false,
  depthMode: false,
  depthWrite: false,
  framebuffer: false,
  frontFace: false,
  program: false,
  rasterDefaults: false,
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
  output.rasterDefaults = unknown
    || !previous.rasterDefaultsKnown
    || previous.scissorEnabled;
  output.blendMode = unknown || previous.alphaBlend !== packet.alphaBlend;
  output.blendFunction = packet.alphaBlend
    && (unknown || !previous.blendFunctionKnown);
  output.cullMode = unknown
    || previous.cullBackFaces !== packet.cullBackFaces;
  output.cullFace = packet.cullBackFaces
    && (unknown || !previous.cullFaceKnown);
  output.depthMode = unknown || previous.depthTest !== packet.depthTest;
  output.depthFunction = packet.depthTest
    && (unknown || !previous.depthFunctionKnown);
  output.frontFace = unknown || previous.frontFace !== packet.frontFace;
  output.writeMasks = unknown || !previous.writeMasksKnown;
  output.depthWrite = unknown || previous.depthWrite !== packet.depthWrite;
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
  if (packet.alphaBlend) state.blendFunctionKnown = true;
  state.cullBackFaces = packet.cullBackFaces;
  if (packet.cullBackFaces) state.cullFaceKnown = true;
  state.depthTest = packet.depthTest;
  if (packet.depthTest) state.depthFunctionKnown = true;
  state.depthWrite = packet.depthWrite;
  state.framebuffer = frame.framebuffer;
  state.frontFace = packet.frontFace;
  state.known = true;
  state.program = packet.program;
  state.rasterDefaultsKnown = true;
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
