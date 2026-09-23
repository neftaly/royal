import { svgRasterSize } from "./svg-raster-size";

export type BrowserImageElementSource = Readonly<{
  close(): void;
  height: number;
  source: HTMLCanvasElement | HTMLImageElement;
  sourceHeight?: number;
  sourceWidth?: number;
  width: number;
}>;

export type BrowserImageElementDecodeOptions = Readonly<{
  fit?: ((width: number, height: number) =>
    Readonly<{ height: number; width: number }>) | undefined;
}>;

const aborted = (): DOMException => new DOMException("Image decode was aborted", "AbortError");

const svgDocument = async (blob: Blob): Promise<Element> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Blob.text() always uses UTF-8; SVG's XML encoding can differ. Honor BOMs
  // first, then transport charset / XML declarations without altering bytes.
  const prefix = new TextDecoder().decode(bytes.subarray(0, 256));
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe || bytes[0] === 0x3c && bytes[1] === 0
    ? "utf-16le"
    : bytes[0] === 0xfe && bytes[1] === 0xff || bytes[0] === 0 && bytes[1] === 0x3c
      ? "utf-16be"
      : bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
        ? "utf-8"
        : /;\s*charset\s*=\s*["']?([^;\s"']+)/i.exec(blob.type)?.[1]
          ?? /^\s*<\?xml\s[^?]*encoding\s*=\s*["']([^"']+)["']/i.exec(prefix)?.[1]
          ?? "utf-8";
  const root = new DOMParser().parseFromString(new TextDecoder(encoding).decode(bytes), "image/svg+xml").documentElement;
  if (root.localName !== "svg" || root.namespaceURI !== "http://www.w3.org/2000/svg") {
    throw new Error("Royal SVG dimensions require a valid SVG document");
  }
  return root;
};

/** Main-thread browser fallback for formats createImageBitmap does not decode consistently. */
export const decodeBrowserImageElement = async (
  blob: Blob,
  signal: AbortSignal,
  options: BrowserImageElementDecodeOptions = {},
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
    const svg = blob.type.split(";", 1)[0]!.trim().toLowerCase() === "image/svg+xml";
    let sourceWidth = image.naturalWidth;
    let sourceHeight = image.naturalHeight;
    if (svg) {
      const root = await svgDocument(blob);
      if (signal.aborted) throw aborted();
      const style = (root as unknown as SVGSVGElement).style;
      const size = svgRasterSize(
        style?.width || root.getAttribute("width"),
        style?.height || root.getAttribute("height"),
        root.getAttribute("viewBox"), sourceWidth, sourceHeight,
      );
      sourceWidth = size.width;
      sourceHeight = size.height;
    }
    if (sourceWidth < 1 || sourceHeight < 1) {
      throw new Error("Royal browser image element decoded to an empty image");
    }
    const fitted = options.fit?.(sourceWidth, sourceHeight)
      ?? { height: sourceHeight, width: sourceWidth };
    if (
      !svg && fitted.width === sourceWidth
      && fitted.height === sourceHeight
    ) {
      let closed = false;
      return {
        close: () => {
          if (closed) return;
          closed = true;
          image.src = "";
          URL.revokeObjectURL(objectUri);
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
    image.width = fitted.width;
    image.height = fitted.height;
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
