import { canvasSupportsImageMimeType } from "../capabilities";
import { throwIfAborted } from "../resource-io";
import { loadGltfBuffers, loadGltfDocument } from "./io";
import type { DecodedGltfDracoPrimitive } from "./codecs/draco";
import { gltfCodecDemand } from "./codecs/demand";
import { assertSupportedRequiredGltfExtensions } from "./extensions";
import { gltfImageDemandKeys } from "./image-demand-coordinator";
import { createGltfImageSourceRecipes } from "./image-source-recipe";
import { estimateGltfPreparationCpu } from "./preparation-admission";
import type {
  GltfLoadMetrics,
  PreparedGltfAsset,
} from "./prepared-asset";
import { preparedGltfPrimitiveMaterials } from "./prepared-asset-materials";
import {
  PreparedGltfRuntime,
  type PreparedGltfCpuAdmission,
  type PreparedGltfState,
} from "./prepared-runtime";
import { readGltfScene } from "./scene-reader";
import type { GltfDocument, GltfMeshPrimitive } from "./schema";

type GltfBasisuCodecModule = typeof import("./codecs/basisu");
type GltfDracoCodecModule = typeof import("./codecs/draco");
type GltfMeshoptCodecModule = typeof import("./codecs/meshopt");

type GltfCodecImports = {
  readonly basisu?: Promise<GltfBasisuCodecModule>;
  readonly draco?: Promise<GltfDracoCodecModule>;
  readonly meshopt?: Promise<GltfMeshoptCodecModule>;
};

const startCodecImport = <Module>(load: () => Promise<Module>): Promise<Module> => {
  const pending = load();
  // Buffer and image IO intentionally overlap module loading. Mark an early
  // import failure handled until the original promise is awaited at its phase.
  void pending.catch(() => undefined);
  return pending;
};

const importCodecs = (document: GltfDocument): GltfCodecImports => {
  const demand = gltfCodecDemand(document);
  return {
    ...(demand.basisu
      ? { basisu: startCodecImport(() => import("./codecs/basisu")) }
      : {}),
    ...(demand.draco
      ? { draco: startCodecImport(() => import("./codecs/draco")) }
      : {}),
    ...(demand.meshopt
      ? { meshopt: startCodecImport(() => import("./codecs/meshopt")) }
      : {}),
  };
};

const nowMs = (): number => globalThis.performance?.now?.() ?? Date.now();

type GltfAssetPreparationOwnerOptions = {
  readonly recordDiagnostic: (message: string, key?: string) => void;
  readonly runtime: PreparedGltfRuntime;
};

/** Owns glTF transport, codec, CPU-admission, scene-read, and recipe phases. */
export class GltfAssetPreparationOwner {
  readonly #options: GltfAssetPreparationOwnerOptions;

  constructor(options: GltfAssetPreparationOwnerOptions) {
    this.#options = options;
  }

  ensure(
    key: string,
    sourceUri: string,
    sourceVersion: number | string | undefined,
    preparedGeneration: number,
  ): PreparedGltfState {
    return this.#options.runtime.ensure(
      key,
      sourceUri,
      sourceVersion,
      preparedGeneration,
      nowMs(),
    );
  }

  async prepare(src: string, assetKey: string, signal: AbortSignal): Promise<PreparedGltfAsset> {
    try {
      const asset = await this.#options.runtime.scheduler.run(
        signal,
        () => this.#prepareAdmitted(src, assetKey, signal),
      );
      throwIfAborted(signal);
      return asset;
    } catch (error) {
      // The admitted job installs final leases immediately before return.
      // Abort may win between that return and this outer boundary.
      this.#options.runtime.releaseCpuLeases(assetKey);
      throw error;
    }
  }

  async #prepareAdmitted(
    src: string,
    assetKey: string,
    signal: AbortSignal,
  ): Promise<PreparedGltfAsset> {
    const load: GltfLoadMetrics = {
      imageFailures: 0,
      imageLoaded: 0,
      imageRequests: 0,
      startedAt: nowMs(),
    };
    let cpuAdmission: PreparedGltfCpuAdmission | undefined;
    try {
      const { binaryChunk, document } = await loadGltfDocument(src, signal);
      load.documentLoadedAt = nowMs();
      throwIfAborted(signal);
      assertSupportedRequiredGltfExtensions(src, document);
      throwIfAborted(signal);
      const cpuEstimate = estimateGltfPreparationCpu(document);
      cpuAdmission = this.#options.runtime.reserveCpuAdmission(assetKey, cpuEstimate);
      throwIfAborted(signal);
      const codecs = importCodecs(document);
      const loadedBuffers = await loadGltfBuffers(src, document, binaryChunk, signal);
      load.buffersLoadedAt = nowMs();
      throwIfAborted(signal);
      const { buffers, document: decodedDocument } = codecs.meshopt === undefined
        ? { buffers: loadedBuffers, document }
        : await (await codecs.meshopt).decodeGltfMeshoptBufferViews(document, loadedBuffers);
      load.meshoptDecodedAt = nowMs();
      throwIfAborted(signal);
      const dracoPrimitives = codecs.draco === undefined
        ? new Map<GltfMeshPrimitive, DecodedGltfDracoPrimitive>()
        : (await codecs.draco).decodeGltfDracoPrimitives(decodedDocument, buffers);
      load.dracoDecodedAt = nowMs();
      throwIfAborted(signal);
      const scene = readGltfScene({
        assetKey,
        buffers,
        diagnostics: { recordDiagnostic: this.#options.recordDiagnostic },
        document: decodedDocument,
        dracoPrimitives,
        src,
        webpSupported: decodedDocument.textures?.some(
          (texture) => texture.extensions?.EXT_texture_webp?.source !== undefined,
        ) === true && canvasSupportsImageMimeType("image/webp"),
      });
      load.sceneReadAt = nowMs();
      load.readyAt = nowMs();
      const materials = preparedGltfPrimitiveMaterials(scene.primitives);
      const imageRecipes = createGltfImageSourceRecipes(
        assetKey,
        src,
        decodedDocument,
        buffers,
        gltfImageDemandKeys(materials, scene.imageBasedLight),
        codecs.basisu,
      );
      const asset: PreparedGltfAsset = {
        hasMaterialLod: scene.hasMaterialLod,
        hasMaterialVariants: scene.hasMaterialVariants,
        hasNodeLod: scene.hasNodeLod,
        ...(scene.imageBasedLight === undefined ? {} : { imageBasedLight: scene.imageBasedLight }),
        ...(imageRecipes.length === 0 ? {} : { imagePreparation: { recipes: imageRecipes } }),
        lights: scene.lights,
        load,
        nodeCount: decodedDocument.nodes?.length ?? 0,
        primitives: scene.primitives,
        variants: scene.variants,
      };
      this.#options.runtime.finalizeCpuAdmission(assetKey, cpuEstimate, asset, cpuAdmission);
      cpuAdmission = undefined;
      return asset;
    } catch (error) {
      load.readyAt = nowMs();
      if (cpuAdmission !== undefined) this.#options.runtime.discardCpuAdmission(cpuAdmission);
      throw error;
    }
  }
}
