import dracoUrl from "./draco-codec.ts?royal-codec-url";
import meshoptUrl from "./meshopt-codec.ts?royal-codec-url";

export type GltfCodecUrls = Readonly<{ draco: string; meshopt: string }>;

// Worker URLs are resolved by the consuming application before crossing realms.
// Each codec is a self-contained module, so it cannot import application code.
let workerUrls: GltfCodecUrls | undefined;
export const setWorkerGltfCodecUrls = (urls: GltfCodecUrls): void => {
  workerUrls = urls;
};
export const gltfCodecUrls = (): GltfCodecUrls => workerUrls ?? {
  draco: new URL(dracoUrl, import.meta.url).href,
  meshopt: new URL(meshoptUrl, import.meta.url).href,
};

export const loadDracoCodec = async (): Promise<typeof import("minidraco")> =>
  import.meta.env.SSR
    ? import("minidraco")
    : import(/* @vite-ignore */ gltfCodecUrls().draco);

export const loadMeshoptCodec = async (): Promise<typeof import("meshoptimizer/decoder")> =>
  import.meta.env.SSR
    ? import("meshoptimizer/decoder")
    : import(/* @vite-ignore */ gltfCodecUrls().meshopt);
