export const createVirtualTextureCanvas = (
  width: number,
  height: number,
  label: string,
): HTMLCanvasElement | OffscreenCanvas => {
  const document = globalThis.document;
  if (typeof document?.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  if (typeof globalThis.OffscreenCanvas === "function") {
    return new globalThis.OffscreenCanvas(width, height);
  }

  throw new Error(`Canvas 2D rendering is unavailable for ${label}`);
};

export const virtualTextureCanvasContext = (
  canvas: HTMLCanvasElement | OffscreenCanvas,
  label: string,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D => {
  const context = canvas.getContext("2d");
  if (context === null) throw new Error(`Canvas 2D rendering is unavailable for ${label}`);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return context;
};
