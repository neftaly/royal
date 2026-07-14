import { closeDecodedTextureSource } from "./decoded-texture-source-lifetime";
import { abortError } from "./gltf/io";

export type LoadHtmlImageOptions = {
  /** Renderer-created same-origin object URLs do not need a CORS request mode. */
  readonly applyCors?: boolean;
  readonly signal?: AbortSignal | undefined;
};

/** The single browser event/decode boundary for DOM-backed texture images. */
export const loadHtmlImage = (
  src: string,
  { applyCors = true, signal }: LoadHtmlImageOptions = {},
): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const ImageConstructor = globalThis.Image;
  if (ImageConstructor === undefined) {
    reject(new Error(`Image loading is unavailable for texture ${src}`));
    return;
  }

  const image = new ImageConstructor();
  if (applyCors) image.crossOrigin = "anonymous";
  let decoding = false;
  let settled = false;
  const cleanup = (): void => {
    image.removeEventListener("load", onLoad);
    image.removeEventListener("error", onError);
    signal?.removeEventListener("abort", onAbort);
  };
  const settle = (complete: () => void): void => {
    if (settled) return;
    settled = true;
    cleanup();
    complete();
  };
  const onAbort = (): void => settle(() => {
    image.src = "";
    closeDecodedTextureSource(image);
    reject(abortError());
  });
  const onLoad = (): void => {
    if (decoding || settled) return;
    decoding = true;
    image.decode().then(
      () => settle(() => resolve(image)),
      (error: unknown) => settle(() => reject(error)),
    );
  };
  const onError = (event: Event): void => settle(() => reject(new Error(
    "message" in event && typeof event.message === "string"
      ? event.message
      : `Image load failed for ${src}`,
  )));

  image.addEventListener("load", onLoad);
  image.addEventListener("error", onError);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted === true) onAbort();
  else {
    image.src = src;
    if (image.complete) onLoad();
  }
});
