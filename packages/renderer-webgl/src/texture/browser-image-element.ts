export type BrowserImageElementSource = Readonly<{
  close(): void;
  height: number;
  source: HTMLCanvasElement;
  width: number;
}>;

const aborted = (): DOMException => new DOMException("Image decode was aborted", "AbortError");

/** Main-thread browser fallback for formats createImageBitmap does not decode consistently. */
export const decodeBrowserImageElement = async (
  blob: Blob,
  signal: AbortSignal,
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
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (context === null) throw new Error("Royal could not allocate an image fallback canvas");
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    image.src = "";
    URL.revokeObjectURL(objectUri);
    let live = true;
    return {
      close: () => {
        if (!live) return;
        live = false;
        canvas.width = 1;
        canvas.height = 1;
      },
      height,
      source: canvas,
      width,
    };
  } catch (error) {
    image.src = "";
    URL.revokeObjectURL(objectUri);
    throw error;
  }
};
