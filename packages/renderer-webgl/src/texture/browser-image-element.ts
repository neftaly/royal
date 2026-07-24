export type BrowserImageElementSource = Readonly<{
  close(): void;
  height: number;
  source: HTMLCanvasElement | HTMLImageElement;
  sourceHeight?: number;
  sourceWidth?: number;
  width: number;
}>;

const aborted = (): DOMException => new DOMException("Image decode was aborted", "AbortError");

/** Main-thread browser fallback for formats createImageBitmap does not decode consistently. */
export const decodeBrowserImageElement = async (
  blob: Blob,
  signal: AbortSignal,
  fit?: (width: number, height: number) => Readonly<{ height: number; width: number }>,
): Promise<BrowserImageElementSource> => {
  if (signal.aborted) throw aborted();
  if (typeof document === "undefined") {
    throw new Error("Royal browser image-element decode requires a document");
  }
  const objectUri = URL.createObjectURL(blob);
  const image = document.createElement("img");
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (failure?: unknown): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        image.onload = null;
        image.onerror = null;
        if (failure === undefined) resolve();
        else reject(failure);
      };
      const onAbort = (): void => finish(aborted());
      image.onload = () => finish();
      image.onerror = () => finish(new Error("Royal browser image-element decode failed"));
      signal.addEventListener("abort", onAbort, { once: true });
      image.src = objectUri;
    });
    if (signal.aborted) throw aborted();
    if (image.naturalWidth < 1 || image.naturalHeight < 1) {
      throw new Error("Royal browser image element decoded to an empty image");
    }
    const sourceWidth = image.naturalWidth;
    const sourceHeight = image.naturalHeight;
    const fitted = fit?.(sourceWidth, sourceHeight)
      ?? { height: sourceHeight, width: sourceWidth };
    if (fitted.width === sourceWidth && fitted.height === sourceHeight) {
      URL.revokeObjectURL(objectUri);
      return {
        close: () => {
          image.src = "";
        },
        height: sourceHeight,
        source: image,
        width: sourceWidth,
      };
    }
    const canvas = document.createElement("canvas");
    canvas.width = fitted.width;
    canvas.height = fitted.height;
    const context = canvas.getContext("2d", { alpha: true });
    if (context === null) throw new Error("Royal could not allocate an image fallback canvas");
    context.drawImage(image, 0, 0, fitted.width, fitted.height);
    image.src = "";
    URL.revokeObjectURL(objectUri);
    return {
      close: () => {
        canvas.width = 1;
        canvas.height = 1;
      },
      height: fitted.height,
      source: canvas,
      sourceHeight,
      sourceWidth,
      width: fitted.width,
    };
  } catch (error) {
    image.src = "";
    URL.revokeObjectURL(objectUri);
    throw error;
  }
};
