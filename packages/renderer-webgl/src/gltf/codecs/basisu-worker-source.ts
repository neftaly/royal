const BASIS_TRANSCODER_COMMIT = "1aab02ba2df16ad873229030ea191ea8c10e3fc9";
const BASIS_TRANSCODER_ROOT = `https://cdn.jsdelivr.net/gh/BinomialLLC/basis_universal@${BASIS_TRANSCODER_COMMIT}/webgl/transcoder/build`;

export type BasisuDecodeTarget = "astc-4x4" | "bc7-m5" | "bc3" | "etc2" | "rgba32";

type BasisuWorkerTarget = Readonly<{
  basisFormat: number;
  compressed: boolean;
  format?: number;
  textureFormat: string;
}>;

export const basisuWorkerTargets: Readonly<Record<BasisuDecodeTarget, BasisuWorkerTarget>> = {
  "astc-4x4": {
    basisFormat: 10,
    compressed: true,
    format: 0x93B0,
    textureFormat: "astc-4x4-unorm",
  },
  "bc7-m5": {
    basisFormat: 7,
    compressed: true,
    format: 0x8E8C,
    textureFormat: "bc7-rgba-unorm",
  },
  bc3: {
    basisFormat: 3,
    compressed: true,
    format: 0x83F3,
    textureFormat: "bc3-rgba-unorm",
  },
  etc2: {
    basisFormat: 1,
    compressed: true,
    format: 0x9278,
    textureFormat: "etc2-rgba8unorm",
  },
  rgba32: {
    basisFormat: 13,
    compressed: false,
    textureFormat: "rgba8unorm",
  },
};

/**
 * A pinned, decoder-only Basis Universal worker. Keeping the transcoder in the
 * worker avoids retaining its WASM heap on the render thread.
 */
export const basisuWorkerSource = `
"use strict";
let basisModule;
const getBasisModule = () => basisModule ??= (async () => {
  importScripts(${JSON.stringify(`${BASIS_TRANSCODER_ROOT}/basis_transcoder.js`)});
  const createBasis = globalThis.BASIS;
  if (typeof createBasis !== "function") throw new Error("Basis transcoder did not load");
  const module = await createBasis({
    locateFile: (file) => file === "basis_transcoder.wasm"
      ? ${JSON.stringify(`${BASIS_TRANSCODER_ROOT}/basis_transcoder.wasm`)}
      : file,
  });
  module.initializeBasis();
  return module;
})();

const targets = ${JSON.stringify(basisuWorkerTargets)};

const message = (error) => error instanceof Error ? error.message : String(error);

globalThis.onmessage = async ({ data }) => {
  const id = data?.id;
  try {
    const descriptor = targets[data?.target];
    if (descriptor === undefined || !(data?.input instanceof ArrayBuffer)) {
      throw new Error("Invalid Basis transcode request");
    }
    const module = await getBasisModule();
    const file = new module.KTX2File(new Uint8Array(data.input));
    try {
      if (!file.isValid()) throw new Error("Invalid KTX2 payload");
      if (!file.startTranscoding()) throw new Error("Failed to start KTX2 transcoding");
      const levelCount = file.getLevels();
      if (!Number.isSafeInteger(levelCount) || levelCount <= 0) {
        throw new Error("KTX2 payload did not contain a texture level");
      }
      const levels = new Array(levelCount);
      const transfers = new Array(levelCount);
      for (let levelIndex = 0; levelIndex < levelCount; levelIndex += 1) {
        const info = file.getImageLevelInfo(levelIndex, 0, 0);
        const size = file.getImageTranscodedSizeInBytes(
          levelIndex,
          0,
          0,
          descriptor.basisFormat,
        );
        if (!Number.isSafeInteger(size) || size <= 0) {
          throw new Error("KTX2 mip decoded an invalid byte size");
        }
        const output = new Uint8Array(size);
        if (!file.transcodeImage(
          output,
          levelIndex,
          0,
          0,
          descriptor.basisFormat,
          0,
          -1,
          -1,
        )) throw new Error("Failed to transcode KTX2 mip " + levelIndex);
        levels[levelIndex] = {
          compressed: descriptor.compressed,
          data: output,
          ...(descriptor.format === undefined ? {} : { format: descriptor.format }),
          height: info.height,
          textureFormat: descriptor.textureFormat,
          width: info.width,
        };
        transfers[levelIndex] = output.buffer;
      }
      globalThis.postMessage({ id, result: [levels] }, transfers);
    } finally {
      file.close();
      file.delete();
    }
  } catch (error) {
    globalThis.postMessage({ error: message(error), id });
  }
};
`;
