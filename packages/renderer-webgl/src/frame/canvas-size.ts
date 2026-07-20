export type CanvasSizeInput = Readonly<{
  /** CSS layout height in pixels. */
  cssHeight: number;
  /** CSS layout width in pixels. */
  cssWidth: number;
  /** Requested backing pixels per CSS pixel. */
  pixelRatio: number;
}>;

export type CanvasSizeLimits = Readonly<{
  maxHeight: number;
  maxWidth: number;
}>;

export type ResolvedCanvasSize = Readonly<{
  /** Applied backing-store height after capability clamping. */
  backingHeight: number;
  /** Applied backing-store width after capability clamping. */
  backingWidth: number;
  /** CSS layout height in pixels. */
  cssHeight: number;
  /** CSS layout width in pixels. */
  cssWidth: number;
  /** Requested backing pixels per CSS pixel before capability clamping. */
  pixelRatio: number;
  /** Capability scale applied after the requested pixel ratio. */
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
  requireFinite(input.pixelRatio, "pixelRatio");
  if (input.cssWidth < 0 || input.cssHeight < 0) {
    throw new RangeError("Royal canvas CSS dimensions must not be negative");
  }
  if (input.pixelRatio <= 0) {
    throw new RangeError("Royal canvas pixelRatio must be greater than 0");
  }
  requirePositiveInteger(limits.maxWidth, "maxWidth");
  requirePositiveInteger(limits.maxHeight, "maxHeight");

  if (input.cssWidth === 0 || input.cssHeight === 0) {
    return {
      backingHeight: 0,
      backingWidth: 0,
      cssHeight: input.cssHeight,
      cssWidth: input.cssWidth,
      pixelRatio: input.pixelRatio,
      renderScale: 0,
    };
  }

  const desiredWidth = input.cssWidth * input.pixelRatio;
  const desiredHeight = input.cssHeight * input.pixelRatio;
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
    pixelRatio: input.pixelRatio,
    renderScale,
  };
};
