import type { ClearFrameIntent } from "../frame/clear-frame";

export type AppliedClearState = {
  clearColorAlpha: number;
  clearColorBlue: number;
  clearColorGreen: number;
  clearColorRed: number;
  clearDepth: number;
  clearStencil: number;
  framebuffer: WebGLFramebuffer | null;
  known: boolean;
  scissorEnabled: boolean;
  scissorHeight: number;
  scissorWidth: number;
  scissorX: number;
  scissorY: number;
  viewportHeight: number;
  viewportWidth: number;
  viewportX: number;
  viewportY: number;
  writeMasksKnown: boolean;
};

export type ClearStateTransition = {
  clearColor: boolean;
  clearDepth: boolean;
  clearStencil: boolean;
  framebuffer: boolean;
  scissorMode: boolean;
  scissorRectangle: boolean;
  viewport: boolean;
  writeMasks: boolean;
};

export const createUnknownClearState = (): AppliedClearState => ({
  clearColorAlpha: 0,
  clearColorBlue: 0,
  clearColorGreen: 0,
  clearColorRed: 0,
  clearDepth: 1,
  clearStencil: 0,
  framebuffer: null,
  known: false,
  scissorEnabled: false,
  scissorHeight: 0,
  scissorWidth: 0,
  scissorX: 0,
  scissorY: 0,
  viewportHeight: 0,
  viewportWidth: 0,
  viewportX: 0,
  viewportY: 0,
  writeMasksKnown: false,
});

export const createClearStateTransition = (): ClearStateTransition => ({
  clearColor: false,
  clearDepth: false,
  clearStencil: false,
  framebuffer: false,
  scissorMode: false,
  scissorRectangle: false,
  viewport: false,
  writeMasks: false,
});

/** Writes a bounded state diff into caller-owned storage without performing GL work. */
export const planClearStateTransition = (
  previous: AppliedClearState,
  next: ClearFrameIntent,
  output: ClearStateTransition,
): void => {
  const unknown = !previous.known;
  output.framebuffer = unknown || previous.framebuffer !== next.framebuffer;
  output.viewport = unknown
    || previous.viewportX !== next.viewport.x
    || previous.viewportY !== next.viewport.y
    || previous.viewportWidth !== next.viewport.width
    || previous.viewportHeight !== next.viewport.height;
  output.scissorMode = unknown || previous.scissorEnabled !== (next.scissor !== null);
  output.scissorRectangle = next.scissor !== null
    && (
      unknown
      || previous.scissorX !== next.scissor.x
      || previous.scissorY !== next.scissor.y
      || previous.scissorWidth !== next.scissor.width
      || previous.scissorHeight !== next.scissor.height
    );
  output.clearColor = unknown
    || previous.clearColorRed !== next.clearColor[0]
    || previous.clearColorGreen !== next.clearColor[1]
    || previous.clearColorBlue !== next.clearColor[2]
    || previous.clearColorAlpha !== next.clearColor[3];
  output.clearDepth = unknown || previous.clearDepth !== next.clearDepth;
  output.clearStencil = unknown || previous.clearStencil !== next.clearStencil;
  output.writeMasks = unknown || !previous.writeMasksKnown;
};

export const commitAppliedClearState = (
  state: AppliedClearState,
  intent: ClearFrameIntent,
): void => {
  state.clearColorRed = intent.clearColor[0];
  state.clearColorGreen = intent.clearColor[1];
  state.clearColorBlue = intent.clearColor[2];
  state.clearColorAlpha = intent.clearColor[3];
  state.clearDepth = intent.clearDepth;
  state.clearStencil = intent.clearStencil;
  state.framebuffer = intent.framebuffer;
  state.scissorEnabled = intent.scissor !== null;
  if (intent.scissor !== null) {
    state.scissorX = intent.scissor.x;
    state.scissorY = intent.scissor.y;
    state.scissorWidth = intent.scissor.width;
    state.scissorHeight = intent.scissor.height;
  }
  state.viewportX = intent.viewport.x;
  state.viewportY = intent.viewport.y;
  state.viewportWidth = intent.viewport.width;
  state.viewportHeight = intent.viewport.height;
  state.writeMasksKnown = true;
  state.known = true;
};
