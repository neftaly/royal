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

export const settleKhronosEnvironmentTestIblBitmaps = async (
  loader: ReturnType<typeof installStagedGltfLoader>,
): Promise<void> => {
  const mipSizes = [256, 128, 64, 32, 16] as const;
  let settled = 0;
  let settledImages = 0;
  for (let attempt = 0; attempt < 80 && settled < 30; attempt += 1) {
    await flushMicrotasks();
    await flushAnimationFrames(latestAnimationFrames);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    while (settledImages < ControlledImage.instances.length) {
      ControlledImage.instances[settledImages]?.settleLoad();
      settledImages += 1;
    }
    while (settled < loader.bitmapRequests.length) {
      loader.bitmapRequests[settled]?.resolve(fakeImageBitmap(mipSizes[settled % mipSizes.length] ?? 16));
      settled += 1;
    }
  }
  expect(loader.bitmapRequests).toHaveLength(30);
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

export const installStagedGltfLoader = () => {
  const bitmapRequests: BitmapRequest[] = [];
  const fetchRequests: FetchRequest[] = [];
  const objectUrlBlobs: Blob[] = [];
  const settledFetches = new Set<FetchRequest>();
  let nextObjectUrl = 0;

  vi.stubGlobal("Image", ControlledImage);
  class TestURL extends URL {
    static createObjectURL = vi.fn((blob: Blob) => {
      objectUrlBlobs.push(blob);
      return `blob:royal-test-${nextObjectUrl += 1}`;
    });
    static revokeObjectURL = vi.fn();
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
  vi.stubGlobal("createImageBitmap", vi.fn(() =>
    new Promise<ImageBitmap>((resolve, reject) => {
      bitmapRequests.push({ reject, resolve });
    })));

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

export const installCanvasImageMimeTypeSupport = (supported: readonly string[]): void => {
  const supportedTypes = new Set(supported.map((type) => type.toLowerCase()));
  vi.stubGlobal("document", {
    createElement: vi.fn((tagName: string) => tagName === "canvas"
      ? {
        toDataURL: vi.fn((type?: string) => {
          const normalizedType = String(type ?? "image/png").toLowerCase();
          return supportedTypes.has(normalizedType)
            ? `data:${normalizedType};base64,AA==`
            : "data:image/png;base64,AA==";
        }),
      }
      : {}),
  });
};

export const installCanvas2d = (): {
  readonly contexts: Array<{
    readonly clearRect: ReturnType<typeof vi.fn>;
    readonly createPattern: ReturnType<typeof vi.fn>;
    readonly drawImage: ReturnType<typeof vi.fn>;
    readonly fillRect: ReturnType<typeof vi.fn>;
    fillStyle: unknown;
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
