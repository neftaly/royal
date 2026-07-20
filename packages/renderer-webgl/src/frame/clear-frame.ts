export type FramebufferSize = Readonly<{
  height: number;
  width: number;
}>;

export type FrameViewport = Readonly<{
  height: number;
  width: number;
  x: number;
  y: number;
}>;

export type LinearRgba = readonly [red: number, green: number, blue: number, alpha: number];

export type ClearFrameIntent = Readonly<{
  clearColor: LinearRgba;
  clearDepth: number;
  clearStencil: number;
  framebuffer: WebGLFramebuffer | null;
  scissor: FrameViewport | null;
  size: FramebufferSize;
  viewport: FrameViewport;
}>;

/** Caller-retained workspace accepted by the readonly clear contract. */
export type MutableClearFrameIntent = {
  clearColor: LinearRgba;
  clearDepth: number;
  clearStencil: number;
  framebuffer: WebGLFramebuffer | null;
  scissor: FrameViewport | null;
  size: { height: number; width: number };
  viewport: { height: number; width: number; x: number; y: number };
};

const requireInteger = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Royal clear frame ${field} must be a safe integer`);
  }
};

const requireDimension = (value: number, field: string): void => {
  requireInteger(value, field);
  if (value < 1) throw new RangeError(`Royal clear frame ${field} must be at least 1`);
};

const requireViewport = (
  viewport: FrameViewport,
  size: FramebufferSize,
  field: string,
): void => {
  requireInteger(viewport.x, `${field}.x`);
  requireInteger(viewport.y, `${field}.y`);
  requireDimension(viewport.width, `${field}.width`);
  requireDimension(viewport.height, `${field}.height`);
  if (
    viewport.x < 0
    || viewport.y < 0
    || viewport.x + viewport.width > size.width
    || viewport.y + viewport.height > size.height
  ) {
    throw new RangeError(`Royal clear frame ${field} must fit inside the framebuffer`);
  }
};

const requireFinite = (value: number, field: string): void => {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Royal clear frame ${field} must be finite`);
  }
};

const requireFiniteUnit = (value: number, field: string): void => {
  requireFinite(value, field);
  if (value < 0 || value > 1) {
    throw new RangeError(`Royal clear frame ${field} must be between 0 and 1`);
  }
};

export const validateClearFrameIntent = (intent: ClearFrameIntent): void => {
  requireDimension(intent.size.width, "size.width");
  requireDimension(intent.size.height, "size.height");
  requireViewport(intent.viewport, intent.size, "viewport");
  if (intent.scissor !== null) requireViewport(intent.scissor, intent.size, "scissor");
  validateLinearRgba(intent.clearColor);
  requireFiniteUnit(intent.clearDepth, "clearDepth");
  requireInteger(intent.clearStencil, "clearStencil");
  if (intent.clearStencil < -0x8000_0000 || intent.clearStencil > 0x7fff_ffff) {
    throw new RangeError("Royal clear frame clearStencil must fit a signed 32-bit integer");
  }
};

export const validateLinearRgba = (color: readonly number[]): void => {
  if (color.length !== 4) {
    throw new TypeError("Royal clear frame clearColor must contain exactly four components");
  }
  requireFinite(color[0]!, "clearColor[0]");
  requireFinite(color[1]!, "clearColor[1]");
  requireFinite(color[2]!, "clearColor[2]");
  requireFiniteUnit(color[3]!, "clearColor[3]");
};
