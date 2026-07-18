export type CanvasSizeInput = Readonly<{
  cssHeight: number;
  cssWidth: number;
  devicePixelRatio: number;
}>;

export type CanvasSizeLimits = Readonly<{
  maxHeight: number;
  maxWidth: number;
}>;

export type ResolvedCanvasSize = Readonly<{
  backingHeight: number;
  backingWidth: number;
  cssHeight: number;
  cssWidth: number;
  devicePixelRatio: number;
  renderScale: number;
}>;

const requireFinite = (value: number, field: string): void => {
  if (!Number.isFinite(value)) throw new TypeError(`Royal canvas ${field} must be finite`);
};

const requirePositiveInteger = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Royal canvas ${field} must be a safe integer`);
  }
  if (value < 1) throw new RangeError(`Royal canvas ${field} must be at least 1`);
};

export const resolveCanvasSize = (
  input: CanvasSizeInput,
  limits: CanvasSizeLimits,
): ResolvedCanvasSize => {
  requireFinite(input.cssWidth, "cssWidth");
  requireFinite(input.cssHeight, "cssHeight");
  requireFinite(input.devicePixelRatio, "devicePixelRatio");
  if (input.cssWidth < 0 || input.cssHeight < 0) {
    throw new RangeError("Royal canvas CSS dimensions must not be negative");
  }
  if (input.devicePixelRatio <= 0) {
    throw new RangeError("Royal canvas devicePixelRatio must be greater than 0");
  }
  requirePositiveInteger(limits.maxWidth, "maxWidth");
  requirePositiveInteger(limits.maxHeight, "maxHeight");

  if (input.cssWidth === 0 || input.cssHeight === 0) {
    return {
      backingHeight: 0,
      backingWidth: 0,
      cssHeight: input.cssHeight,
      cssWidth: input.cssWidth,
      devicePixelRatio: input.devicePixelRatio,
      renderScale: 0,
    };
  }

  const desiredWidth = input.cssWidth * input.devicePixelRatio;
  const desiredHeight = input.cssHeight * input.devicePixelRatio;
  if (!Number.isSafeInteger(Math.ceil(desiredWidth)) || !Number.isSafeInteger(Math.ceil(desiredHeight))) {
    throw new RangeError("Royal canvas resolved dimensions exceed safe integer range");
  }
  const renderScale = Math.min(
    1,
    limits.maxWidth / desiredWidth,
    limits.maxHeight / desiredHeight,
  );
  return {
    backingHeight: Math.max(1, Math.floor(desiredHeight * renderScale)),
    backingWidth: Math.max(1, Math.floor(desiredWidth * renderScale)),
    cssHeight: input.cssHeight,
    cssWidth: input.cssWidth,
    devicePixelRatio: input.devicePixelRatio,
    renderScale,
  };
};
