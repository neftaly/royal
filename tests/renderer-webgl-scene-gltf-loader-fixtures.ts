import { expect, vi } from "vitest";
import {
  lodBin,
  triangleBin,
} from "./renderer-webgl-scene-gltf-binary-fixtures";
import { triangleDocument } from "./renderer-webgl-scene-gltf-material-documents";
import {
  ControlledImage,
  fakeImageBitmap,
  flushAnimationFrames,
  flushMicrotasks,
  latestAnimationFrames,
  type BitmapRequest,
  type FetchRequest,
} from "./renderer-webgl-scene-gltf-test-runtime";

export const settleKhronosEnvironmentTestImages = async (
  loader: ReturnType<typeof installStagedGltfLoader>,
): Promise<void> => {
  const expectedImages = 32;
  const mipSizes = [256, 128, 64, 32, 16] as const;
  let settledRequests = 0;
  let settledIbl = 0;
  let settledImages = 0;
  for (let attempt = 0; attempt < 80 && settledRequests < expectedImages; attempt += 1) {
    await flushMicrotasks();
    await flushAnimationFrames(latestAnimationFrames);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    while (loader.resolvePendingFetch(/roughness_metallic_\d+\.png(?:$|[?#])/, (url) =>
      responseWithBuffer(url, Uint8Array.of(0).buffer))) {
      // Resolve both ordinary material images transported alongside the 30
      // embedded environment faces.
    }
    while (settledImages < ControlledImage.instances.length) {
      ControlledImage.instances[settledImages]?.settleLoad();
      settledImages += 1;
    }
    while (settledRequests < loader.bitmapRequests.length) {
      const request = loader.bitmapRequests[settledRequests];
      const ordinaryTransport = request?.source instanceof Blob && request.source.size === 1;
      const size = ordinaryTransport ? 1 : (mipSizes[settledIbl % mipSizes.length] ?? 16);
      request?.resolve(fakeImageBitmap(size));
      settledRequests += 1;
      if (!ordinaryTransport) settledIbl += 1;
    }
  }
  expect(loader.bitmapRequests).toHaveLength(expectedImages);
  expect(settledIbl).toBe(30);
  await flushMicrotasks();
};

export const responseWithJson = (url: string, json: unknown): Response => {
  const text = JSON.stringify(json);

  return {
    arrayBuffer: vi.fn(() => Promise.resolve(new TextEncoder().encode(text).buffer)),
    blob: vi.fn(() => Promise.resolve(new Blob([text], { type: "model/gltf+json" }))),
    json: vi.fn(() => Promise.resolve(json)),
    ok: true,
    status: 200,
    statusText: "OK",
    text: vi.fn(() => Promise.resolve(text)),
    url,
  } as unknown as Response;
};

export const responseWithBuffer = (url: string, buffer: ArrayBuffer): Response => ({
  arrayBuffer: vi.fn(() => Promise.resolve(buffer)),
  blob: vi.fn(() => Promise.resolve(new Blob([buffer], { type: "application/octet-stream" }))),
  ok: true,
  status: 200,
  statusText: "OK",
  url,
}) as unknown as Response;

export const responseWithText = (url: string, text: string, type = "text/plain"): Response => ({
  arrayBuffer: vi.fn(() => Promise.resolve(new TextEncoder().encode(text).buffer)),
  blob: vi.fn(() => Promise.resolve(new Blob([text], { type }))),
  ok: true,
  status: 200,
  statusText: "OK",
  text: vi.fn(() => Promise.resolve(text)),
  url,
}) as unknown as Response;

export const requestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if ("url" in input && typeof input.url === "string") return input.url;

  return Object.prototype.toString.call(input);
};

export const installStagedGltfLoader = (
  { bitmapDecode = false }: Readonly<{ bitmapDecode?: boolean }> = {},
) => {
  const bitmapRequests: BitmapRequest[] = [];
  const fetchRequests: FetchRequest[] = [];
  const objectUrlBlobs: Blob[] = [];
  const settledFetches = new Set<FetchRequest>();
  let nextObjectUrl = 0;

  vi.stubGlobal("Image", ControlledImage);
  class TestURL extends URL {
    static override createObjectURL = vi.fn((blob: Blob) => {
      objectUrlBlobs.push(blob);
      return `blob:royal-test-${nextObjectUrl += 1}`;
    });
    static override revokeObjectURL = vi.fn();
  }
  vi.stubGlobal("URL", TestURL);
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) =>
    new Promise<Response>((resolve, reject) => {
      fetchRequests.push({
        reject,
        resolve,
        url: requestUrl(input),
      });
    })));
  if (bitmapDecode) {
    vi.stubGlobal("createImageBitmap", vi.fn((source: ImageBitmapSource) =>
      new Promise<ImageBitmap>((resolve, reject) => {
        bitmapRequests.push({ reject, resolve, source });
      })));
  } else {
    // Keep compatibility-path tests deterministic even when another test or
    // future test runtime supplies createImageBitmap.
    vi.stubGlobal("createImageBitmap", undefined);
  }

  return {
    bitmapRequests,
    fetchRequests,
    objectUrlBlobs,
    rejectPendingFetch: (pattern: RegExp, reason: unknown): boolean => {
      const request = fetchRequests.find((entry) => !settledFetches.has(entry) && pattern.test(entry.url));
      if (request === undefined) return false;

      settledFetches.add(request);
      request.reject(reason);

      return true;
    },
    resolvePendingFetch: (pattern: RegExp, response: (url: string) => Response): boolean => {
      const request = fetchRequests.find((entry) => !settledFetches.has(entry) && pattern.test(entry.url));
      if (request === undefined) return false;

      settledFetches.add(request);
      request.resolve(response(request.url));

      return true;
    },
  };
};

export const installCanvas2d = (): {
  readonly contexts: Array<{
    readonly clearRect: ReturnType<typeof vi.fn>;
    readonly createPattern: ReturnType<typeof vi.fn>;
    readonly drawImage: ReturnType<typeof vi.fn>;
    readonly fillRect: ReturnType<typeof vi.fn>;
    fillStyle: unknown;
    readonly getImageData: ReturnType<typeof vi.fn>;
    imageSmoothingEnabled: boolean;
    imageSmoothingQuality: ImageSmoothingQuality;
    readonly putImageData: ReturnType<typeof vi.fn>;
  }>;
} => {
  const contexts: Array<{
    readonly clearRect: ReturnType<typeof vi.fn>;
    readonly createPattern: ReturnType<typeof vi.fn>;
    readonly drawImage: ReturnType<typeof vi.fn>;
    readonly fillRect: ReturnType<typeof vi.fn>;
    fillStyle: unknown;
    readonly getImageData: ReturnType<typeof vi.fn>;
    imageSmoothingEnabled: boolean;
    imageSmoothingQuality: ImageSmoothingQuality;
    readonly putImageData: ReturnType<typeof vi.fn>;
  }> = [];

  vi.stubGlobal("document", {
    createElement: vi.fn((tagName: string) => {
      if (tagName !== "canvas") throw new Error(`unexpected element ${tagName}`);
      const context = {
        clearRect: vi.fn(),
        createPattern: vi.fn(() => ({ setTransform: vi.fn() })),
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        fillStyle: "#000",
        getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
          height,
          width,
        }) as ImageData),
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low" as ImageSmoothingQuality,
        putImageData: vi.fn(),
      };
      contexts.push(context);

      return {
        height: 0,
        getContext: vi.fn((contextId: string) => contextId === "2d" ? context : null),
        width: 0,
      };
    }),
  });

  return { contexts };
};

export const settleDocumentAndBuffer = async (
  loader: ReturnType<typeof installStagedGltfLoader>,
): Promise<void> => {
  expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
    responseWithJson(url, triangleDocument()))).toBe(true);
  await flushMicrotasks();
  expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
    responseWithBuffer(url, triangleBin()))).toBe(true);
  await flushMicrotasks();
};

export const settleLodDocumentAndBuffer = async (
  loader: ReturnType<typeof installStagedGltfLoader>,
  document: unknown,
): Promise<void> => {
  expect(loader.resolvePendingFetch(/lod\.gltf(?:$|[?#])/, (url) =>
    responseWithJson(url, document))).toBe(true);
  await flushMicrotasks();
  expect(loader.resolvePendingFetch(/lod\.bin(?:$|[?#])/, (url) =>
    responseWithBuffer(url, lodBin()))).toBe(true);
  await flushMicrotasks();
};
