import type { LoadedTextureSource } from "./texture-sources";
import {
  abortError,
  dataUriMediaType,
  decodeDataUri,
  gltfBufferViewBytes,
  resolveResourceUri,
} from "./gltf/io";
import type { GltfDocument, GltfImage } from "./gltf/schema";
import {
  generatedVirtualTexturePageCount,
  virtualTexturePageKey,
  type VirtualTextureManifestModel,
  type VirtualTexturePageId,
} from "./virtual-texturing";

const GENERATED_SVG_VIRTUAL_TEXTURE_PAGE_SIZE = 256;
const GENERATED_SVG_VIRTUAL_TEXTURE_PHYSICAL_SLOT_CAP = 64;

const svgRootPattern = /<svg\b([^>]*)>/iu;
const svgViewBoxPattern = /\bviewBox\s*=\s*(["'])(.*?)\1/iu;
const svgWidthPattern = /\bwidth\s*=\s*(["'])(.*?)\1/iu;
const svgHeightPattern = /\bheight\s*=\s*(["'])(.*?)\1/iu;
const svgXmlBasePattern = /\bxml:base\s*=\s*(["'])(.*?)\1/iu;
const svgImageElementPattern = /<image\b[^>]*>/giu;
const svgHrefAttributePattern = /\b((?:xlink:)?href)\s*=\s*(["'])(.*?)\2/giu;
const svgScriptElementPattern = /<script\b[^>]*>[\s\S]*?<\/script\s*>|<script\b[^>]*\/\s*>/giu;
const svgEventHandlerAttributePattern = /\s+on[a-z][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu;
const svgUnsafeHrefAttributePattern = /\s+((?:xlink:)?href)\s*=\s*(["'])\s*(?:javascript|data:text\/html)\s*:[\s\S]*?\2/giu;
const svgDimensionPattern = /^\s*([+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:e[+-]?\d+)?)\s*(?:px|pt|pc|mm|cm|in)?\s*$/iu;
const svgExternalReferenceMaxDepth = 8;
const svgTextDecoder = new TextDecoder();
const svgTextEncoder = new TextEncoder();
const svgVirtualTextureSourceSymbol = Symbol("royal.svgVirtualTextureSource");

export type SvgVirtualTextureSource = {
  readonly height: number;
  readonly label: string;
  readonly text: string;
  readonly width: number;
};

export type LoadedSvgTexture = {
  readonly image: HTMLImageElement;
  readonly text: string;
};

type SvgTextureViewport = {
  readonly fromViewBox: boolean;
  readonly height: number;
  readonly width: number;
};

type SvgVirtualTextureSourceCarrier = {
  [svgVirtualTextureSourceSymbol]?: SvgVirtualTextureSource;
};

type SvgImageReferenceContext = {
  readonly cache: Map<string, Promise<string>>;
  readonly depth: number;
  readonly path: readonly string[];
  readonly signal?: AbortSignal;
};

export const isSvgMimeType = (mimeType: string | undefined): boolean =>
  mimeType?.toLowerCase() === "image/svg+xml";

export const isSvgUri = (uri: string): boolean =>
  uri.startsWith("data:")
    ? isSvgMimeType(dataUriMediaType(uri))
    : /\.svg(?:$|[?#])/iu.test(uri);

const positiveFinite = (value: number): boolean => Number.isFinite(value) && value > 0;

const parseSvgDimension = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const match = svgDimensionPattern.exec(value);
  if (match === null) return undefined;
  const parsed = Number.parseFloat(match[1] ?? "");

  return positiveFinite(parsed) ? parsed : undefined;
};

const svgTextureViewport = (svgText: string): SvgTextureViewport | undefined => {
  const svgRoot = svgRootPattern.exec(svgText);
  if (svgRoot === null) return undefined;

  const attributes = svgRoot[1] ?? "";
  const width = parseSvgDimension(svgWidthPattern.exec(attributes)?.[2]);
  const height = parseSvgDimension(svgHeightPattern.exec(attributes)?.[2]);
  if (width !== undefined && height !== undefined) {
    return {
      fromViewBox: false,
      height,
      width,
    };
  }

  const viewBox = svgViewBoxPattern.exec(attributes)?.[2];
  if (viewBox !== undefined) {
    const values = viewBox.trim().split(/[\s,]+/u).map((value) => Number(value));
    if (
      values.length === 4
      && values.every((value) => Number.isFinite(value))
      && positiveFinite(values[2] ?? Number.NaN)
      && positiveFinite(values[3] ?? Number.NaN)
    ) {
      return {
        fromViewBox: true,
        height: values[3]!,
        width: values[2]!,
      };
    }
  }

  return undefined;
};

const svgNumberAttribute = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));

const escapeSvgAttribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const absoluteSvgBaseUrl = (url: string, baseUrl?: string): string => {
  try {
    const base = globalThis.document?.baseURI ?? globalThis.location?.href;
    return new URL(url, baseUrl ?? base).href;
  } catch {
    return url;
  }
};

const svgRootBaseUrl = (attributes: string, documentBaseUrl: string): string => {
  const authoredBase = svgXmlBasePattern.exec(attributes)?.[2];
  return authoredBase === undefined
    ? documentBaseUrl
    : absoluteSvgBaseUrl(authoredBase, documentBaseUrl);
};

const svgRootBaseUrlForText = (svgText: string, documentBaseUrl: string): string => {
  const svgRoot = svgRootPattern.exec(svgText);
  return svgRoot === null ? documentBaseUrl : svgRootBaseUrl(svgRoot[1] ?? "", documentBaseUrl);
};

const shouldInlineSvgImageReference = (href: string): boolean =>
  href.trim() !== ""
  && !href.startsWith("#")
  && !/^(?:about|blob|data|javascript|mailto):/iu.test(href);

const responseContentMimeType = (response: Response): string | undefined => {
  const header = (response as { readonly headers?: Headers }).headers?.get("content-type");
  const mediaType = header?.split(";")[0]?.trim().toLowerCase();
  return mediaType === "" ? undefined : mediaType;
};

const imageMimeTypeForUrl = (url: string, response: Response): string => {
  const contentType = responseContentMimeType(response);
  if (contentType !== undefined) return contentType;
  if (/\.svg(?:$|[?#])/iu.test(url)) return "image/svg+xml";
  if (/\.avif(?:$|[?#])/iu.test(url)) return "image/avif";
  if (/\.webp(?:$|[?#])/iu.test(url)) return "image/webp";
  if (/\.jpe?g(?:$|[?#])/iu.test(url)) return "image/jpeg";
  if (/\.png(?:$|[?#])/iu.test(url)) return "image/png";
  if (/\.gif(?:$|[?#])/iu.test(url)) return "image/gif";
  return "application/octet-stream";
};

const base64Bytes = (bytes: Uint8Array): string => {
  const encode = globalThis.btoa;
  if (typeof encode !== "function") throw new Error("Base64 encoding is unavailable for SVG image reference");

  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return encode(binary);
};

const bytesDataUri = (bytes: Uint8Array, mimeType: string): string =>
  `data:${mimeType};base64,${base64Bytes(bytes)}`;

const setSvgAttribute = (attributes: string, name: string, value: string): string => {
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(["']).*?\\1`, "iu");
  const attribute = `${name}="${escapeSvgAttribute(value)}"`;
  if (pattern.test(attributes)) return attributes.replace(pattern, attribute);

  return `${attributes} ${attribute}`;
};

const sanitizeSvgTextForImage = (svgText: string): string =>
  svgText
    .replace(svgScriptElementPattern, "")
    .replace(svgEventHandlerAttributePattern, "")
    .replace(svgUnsafeHrefAttributePattern, "");

const svgTextWithFiniteImageDimensions = (
  svgText: string,
  label: string,
  baseUrl?: string,
  { requireViewport = true }: { readonly requireViewport?: boolean } = {},
): string => {
  const viewport = svgTextureViewport(svgText);
  if (viewport === undefined) {
    if (!requireViewport && baseUrl === undefined) return svgText;
    if (!requireViewport && baseUrl !== undefined) {
      const svgRoot = svgRootPattern.exec(svgText);
      if (svgRoot === null) return svgText;
      const attributes = setSvgAttribute(svgRoot[1] ?? "", "xml:base", svgRootBaseUrl(svgRoot[1] ?? "", baseUrl));
      return `${svgText.slice(0, svgRoot.index)}<svg${attributes}>${svgText.slice(svgRoot.index + svgRoot[0].length)}`;
    }
    throw new Error(`${label} requires a finite viewBox or finite width and height`);
  }
  if (!viewport.fromViewBox && baseUrl === undefined) return svgText;

  const svgRoot = svgRootPattern.exec(svgText);
  if (svgRoot === null) return svgText;

  let attributes = svgRoot[1] ?? "";
  if (viewport.fromViewBox) {
    attributes = setSvgAttribute(attributes, "width", svgNumberAttribute(viewport.width));
    attributes = setSvgAttribute(attributes, "height", svgNumberAttribute(viewport.height));
  }
  if (baseUrl !== undefined) attributes = setSvgAttribute(attributes, "xml:base", svgRootBaseUrl(attributes, baseUrl));

  return `${svgText.slice(0, svgRoot.index)}<svg${attributes}>${svgText.slice(svgRoot.index + svgRoot[0].length)}`;
};

const fetchSvgImageReferenceValue = (
  href: string,
  baseUrl: string,
  label: string,
  context: SvgImageReferenceContext,
): Promise<string> => {
  if (context.depth >= svgExternalReferenceMaxDepth) {
    return Promise.reject(new Error(`${label} exceeds nested SVG image reference depth ${svgExternalReferenceMaxDepth}`));
  }

  const url = absoluteSvgBaseUrl(href, baseUrl);
  const cycleStart = context.path.indexOf(url);
  if (cycleStart >= 0) {
    const cycle = [...context.path.slice(cycleStart), url].join(" -> ");
    return Promise.reject(new Error(`${label} contains a cyclic SVG image reference: ${cycle}`));
  }
  const cached = context.cache.get(url);
  if (cached !== undefined) return cached;

  const request = (async (): Promise<string> => {
    if (context.signal?.aborted === true) throw abortError();
    const response = await fetch(url, context.signal === undefined ? undefined : { signal: context.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

    const responseUrl = absoluteSvgBaseUrl(response.url || url, baseUrl);
    const mimeType = imageMimeTypeForUrl(responseUrl, response);
    if (mimeType === "image/svg+xml") {
      const preparedText = await prepareSvgTextForImage(
        await response.text(),
        `SVG image reference ${responseUrl}`,
        responseUrl,
        {
          context: {
            cache: context.cache,
            depth: context.depth + 1,
            path: [...context.path, url],
            ...(context.signal === undefined ? {} : { signal: context.signal }),
          },
          requireViewport: false,
        },
      );

      return bytesDataUri(svgTextEncoder.encode(preparedText), "image/svg+xml");
    }

    return bytesDataUri(new Uint8Array(await response.arrayBuffer()), mimeType);
  })();
  context.cache.set(url, request);
  return request;
};

const inlineSvgImageReferences = async (
  svgText: string,
  label: string,
  baseUrl: string,
  context: SvgImageReferenceContext,
): Promise<string> => {
  const rootBaseUrl = svgRootBaseUrlForText(svgText, baseUrl);
  const replacements = new Map<string, Promise<string>>();

  for (const imageMatch of svgText.matchAll(svgImageElementPattern)) {
    const imageTag = imageMatch[0];
    for (const hrefMatch of imageTag.matchAll(svgHrefAttributePattern)) {
      const href = hrefMatch[3] ?? "";
      if (!shouldInlineSvgImageReference(href)) continue;
      replacements.set(href, fetchSvgImageReferenceValue(href, rootBaseUrl, label, context));
    }
  }

  if (replacements.size === 0) return svgText;

  const resolved = new Map<string, string>();
  await Promise.all([...replacements].map(async ([href, value]) => {
    resolved.set(href, await value);
  }));

  return svgText.replace(svgImageElementPattern, (imageTag) =>
    imageTag.replace(svgHrefAttributePattern, (attribute, name: string, quote: string, href: string) => {
      const replacement = resolved.get(href);
      return replacement === undefined ? attribute : `${name}=${quote}${replacement}${quote}`;
    }));
};

export const prepareSvgTextForImage = async (
  svgText: string,
  label: string,
  baseUrl: string | undefined,
  {
    context = { cache: new Map<string, Promise<string>>(), depth: 0, path: [] },
    requireViewport = true,
  }: {
    readonly context?: SvgImageReferenceContext;
    readonly requireViewport?: boolean;
  } = {},
): Promise<string> => {
  const sanitizedText = sanitizeSvgTextForImage(svgText);
  const normalizedText = svgTextWithFiniteImageDimensions(sanitizedText, label, baseUrl, { requireViewport });
  return baseUrl === undefined
    ? normalizedText
    : inlineSvgImageReferences(normalizedText, label, baseUrl, context);
};

const loadImage = (src: string, signal?: AbortSignal): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const ImageConstructor = globalThis.Image;
  if (ImageConstructor === undefined) {
    reject(new Error(`Image loading is unavailable for texture ${src}`));
    return;
  }

  const image = new ImageConstructor();
  image.crossOrigin = "anonymous";
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
  const onAbort = (): void => {
    settle(() => {
      image.src = "";
      reject(abortError());
    });
  };
  const onLoad = (): void => {
    const decoded = typeof image.decode === "function" ? image.decode() : Promise.resolve();
    decoded.then(() => {
      settle(() => resolve(image));
    }, (error: unknown) => {
      settle(() => reject(error));
    });
  };
  const onError = (event: Event): void => {
    const message = "message" in event && typeof event.message === "string"
      ? event.message
      : `Image load failed for ${src}`;
    settle(() => reject(new Error(message)));
  };

  image.addEventListener("load", onLoad);
  image.addEventListener("error", onError);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted === true) {
    onAbort();
    return;
  }
  image.src = src;

  if (image.complete) onLoad();
});

const loadImageFromBlob = async (blob: Blob, label: string, signal?: AbortSignal): Promise<HTMLImageElement> => {
  if (
    typeof globalThis.URL?.createObjectURL !== "function"
    || typeof globalThis.URL.revokeObjectURL !== "function"
  ) {
    throw new Error(`Object URL loading is unavailable for ${label}`);
  }

  const url = globalThis.URL.createObjectURL(blob);
  try {
    return await loadImage(url, signal);
  } finally {
    globalThis.URL.revokeObjectURL(url);
  }
};

const attachSvgVirtualTextureSource = (
  image: HTMLImageElement,
  source: SvgVirtualTextureSource,
): HTMLImageElement => {
  (image as SvgVirtualTextureSourceCarrier)[svgVirtualTextureSourceSymbol] = source;
  return image;
};

export const svgVirtualTextureSourceForImage = (
  image: LoadedTextureSource,
): SvgVirtualTextureSource | undefined =>
  typeof image === "object" && image !== null
    ? (image as SvgVirtualTextureSourceCarrier)[svgVirtualTextureSourceSymbol]
    : undefined;

const loadSvgTextImage = async (
  svgText: string,
  label: string,
  baseUrl?: string,
  signal?: AbortSignal,
): Promise<LoadedSvgTexture> => {
  const normalizedText = await prepareSvgTextForImage(svgText, label, baseUrl, {
    context: {
      cache: new Map(),
      depth: 0,
      path: [],
      ...(signal === undefined ? {} : { signal }),
    },
  });
  const viewport = svgTextureViewport(normalizedText);
  const image = await loadImageFromBlob(new Blob([normalizedText], { type: "image/svg+xml" }), label, signal);

  return {
    image: viewport === undefined
      ? image
      : attachSvgVirtualTextureSource(image, {
        height: viewport.height,
        label,
        text: normalizedText,
        width: viewport.width,
      }),
    text: normalizedText,
  };
};

export const generatedSvgVirtualTextureManifest = (
  source: SvgVirtualTextureSource,
): VirtualTextureManifestModel => {
  const width = Math.max(1, Math.ceil(source.width));
  const height = Math.max(1, Math.ceil(source.height));
  const pageSize = Math.min(GENERATED_SVG_VIRTUAL_TEXTURE_PAGE_SIZE, Math.max(width, height));
  const physicalSlots = Math.min(
    GENERATED_SVG_VIRTUAL_TEXTURE_PHYSICAL_SLOT_CAP,
    generatedVirtualTexturePageCount(width, height, pageSize),
  );

  return {
    colorSpace: "srgb",
    height,
    pageSize,
    pages: [],
    physicalSlots,
    width,
  };
};

const generatedSvgVirtualTexturePageText = (
  source: SvgVirtualTextureSource,
  manifest: VirtualTextureManifestModel,
  page: VirtualTexturePageId,
): string => {
  const mipScale = 2 ** page.mip;
  const sourceX = page.x * manifest.pageSize * mipScale;
  const sourceY = page.y * manifest.pageSize * mipScale;
  const sourceWidth = Math.max(1, Math.min(manifest.pageSize * mipScale, manifest.width - sourceX));
  const sourceHeight = Math.max(1, Math.min(manifest.pageSize * mipScale, manifest.height - sourceY));
  const href = bytesDataUri(svgTextEncoder.encode(source.text), "image/svg+xml");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${manifest.pageSize}" height="${manifest.pageSize}"`,
    ` viewBox="${svgNumberAttribute(sourceX)} ${svgNumberAttribute(sourceY)} ${svgNumberAttribute(sourceWidth)} ${svgNumberAttribute(sourceHeight)}"`,
    " preserveAspectRatio=\"none\">",
    `<image href="${escapeSvgAttribute(href)}" x="0" y="0" width="${svgNumberAttribute(source.width)}"`,
    ` height="${svgNumberAttribute(source.height)}" preserveAspectRatio="none"/>`,
    "</svg>",
  ].join("");
};

export const loadGeneratedSvgVirtualTexturePageImage = (
  source: SvgVirtualTextureSource,
  manifest: VirtualTextureManifestModel,
  page: VirtualTexturePageId,
  signal?: AbortSignal,
): Promise<HTMLImageElement> =>
  loadImageFromBlob(
    new Blob([generatedSvgVirtualTexturePageText(source, manifest, page)], { type: "image/svg+xml" }),
    `generated SVG virtual texture page ${source.label} ${virtualTexturePageKey(page)}`,
    signal,
  );

export const loadSvgTextureFromUri = async (url: string, signal?: AbortSignal): Promise<LoadedSvgTexture> => {
  if (signal?.aborted === true) throw abortError();
  const response = await fetch(url, signal === undefined ? undefined : { signal });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

  return loadSvgTextImage(
    await response.text(),
    `glTF GS_texture_svg image ${url}`,
    absoluteSvgBaseUrl(response.url || url),
    signal,
  );
};

export const loadGltfSvgTexture = async (
  src: string,
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  image: GltfImage,
  signal?: AbortSignal,
): Promise<LoadedSvgTexture> => {
  if (image.uri !== undefined) {
    if (image.uri.startsWith("data:")) {
      const bytes = decodeDataUri(image.uri);
      return loadSvgTextImage(
        svgTextDecoder.decode(bytes),
        `glTF GS_texture_svg data URI ${image.uri.slice(0, 48)}`,
        absoluteSvgBaseUrl(src),
        signal,
      );
    }

    return loadSvgTextureFromUri(resolveResourceUri(src, image.uri), signal);
  }
  if (image.bufferView === undefined) {
    throw new Error("glTF GS_texture_svg image has no URI or bufferView");
  }
  const bytes = gltfBufferViewBytes(document, buffers, image.bufferView);
  return loadSvgTextImage(
    svgTextDecoder.decode(bytes),
    `glTF GS_texture_svg bufferView ${image.bufferView}`,
    absoluteSvgBaseUrl(src),
    signal,
  );
};
