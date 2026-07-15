import type { TextureRef, TextureSamplerWrap } from "@royal/renderer-core";
import type { Mat4 } from "../math/mat4";
import type { GltfTextureCoordinates } from "../gltf/texture-coordinates";
import type { VirtualTextureCoverageProvider } from "./coverage-provider";
import type { TextureAssetUploadRef } from "../webgl/materials";
import {
  type VirtualTextureManifestModel,
  type VirtualTextureManifestParseResult,
  type VirtualTexturePageId,
} from "./model";
export const VIRTUAL_TEXTURE_MAX_PAGE_REQUESTS_PER_FRAME = 4;
export const VIRTUAL_TEXTURE_MAX_IN_FLIGHT_PAGE_LOADS = 4;
export const VIRTUAL_TEXTURE_MAX_DEMAND_PAGES_PER_DRAW = 32;
export const VIRTUAL_TEXTURE_MAX_PAGE_LOAD_RETRIES = 2;
export const VIRTUAL_TEXTURE_PAGE_RETRY_BASE_DELAY_MS = 50;

export type ViewportSize = readonly [width: number, height: number];
export type VirtualTextureRef = Extract<TextureRef, { readonly kind: "virtual-asset" }>;

export type VirtualTexturePagePayload =
  | {
      readonly close?: () => void;
      readonly image: TexImageSource;
      readonly kind: "image";
    }
  | {
      readonly data: Uint8Array;
      readonly format: number;
      readonly height: number;
      readonly kind: "compressed";
      readonly srgbFormat: number;
      readonly width: number;
    };

export type VirtualTexturePageLoad =
  | { readonly kind: "absent" }
  | { readonly kind: "page"; readonly promise: Promise<VirtualTexturePagePayload> };

type VirtualTexturePageLoader = (
  manifest: VirtualTextureManifestModel,
  page: VirtualTexturePageId,
  signal: AbortSignal,
) => VirtualTexturePageLoad;

type ImmediateVirtualTexturePageSource = {
  readonly loadManifest?: never;
  readonly manifest: VirtualTextureManifestParseResult;
};

type DeferredVirtualTexturePageSource = {
  readonly loadManifest: (signal: AbortSignal) => Promise<VirtualTextureManifestParseResult>;
  readonly manifest?: never;
};

/** Format adapter consumed by the runtime shell; demand and residency see only its manifest. */
export type VirtualTexturePageSource = (ImmediateVirtualTexturePageSource | DeferredVirtualTexturePageSource) & {
  readonly loadPage: VirtualTexturePageLoader;
  readonly manifestUri: string;
};

type VirtualTextureRuntimeStatus = "error" | "loading" | "ready" | "unsupported";

export type VirtualTextureRuntimeStats = {
  demandAdmissions: number;
  demandRetentionOverflows: number;
  demandRetentions: number;
  automaticManifestUses: number;
  automaticPagesTarget: number;
  automaticSourceBytes: number;
  manifestFailures: number;
  gpuAdmissionFailures: number;
  pageLoadFailures: number;
  pageLoadDurationMaxMs: number;
  pageLoadDurationMs: number;
  pageLoadDurationSamples: number;
  pageLoadRequests: number;
  manifestRequests: number;
  preparedResidencyResolutions: number;
  shaderBinds: number;
  unreadyDraws: number;
  unsupportedDraws: number;
};

export type VirtualTextureRuntimeState = {
  activeSource: VirtualTexturePageSource;
  /** Monotonic handoff: automatic VT never returns to ordinary source selection after activation. */
  automaticResidencyActivated?: true;
  availablePageKeys?: ReadonlySet<string>;
  /** Stable root-policy ordering for admission and cold-reclamation ties. */
  readonly admissionTicket: number;
  demandPublished: boolean;
  /** Raw current draw demand before terminal-page convergence filtering. */
  demandedPageKeys: Set<string>;
  demandedPageKeysScratch: Set<string>;
  diagnosticsEnabled: boolean;
  /** GPU publication target: exact current demand plus bounded replacement overlap while converging. */
  desiredPageKeys: Set<string>;
  desiredPageKeysScratch: Set<string>;
  /** Ordered counterpart of `desiredPageKeys`; inactive physical cache is owned by the GPU arena. */
  desiredPages: VirtualTexturePageId[];
  desiredPagesScratch: VirtualTexturePageId[];
  error?: string;
  readonly key: string;
  /** Most recent successfully committed frame that contained draw demand. */
  lastDemandFrame: number;
  manifestAbortController?: AbortController;
  manifest?: VirtualTextureManifestModel;
  sourceGeneration: number;
  stats: VirtualTextureRuntimeStats;
  status: VirtualTextureRuntimeStatus;
  readonly texture: VirtualTextureRef;
};

export type BaseColorTextureResidency =
  | { readonly kind: "none" }
  | { readonly kind: "ordinary"; readonly texture: TextureAssetUploadRef }
  | {
      readonly kind: "prepared-virtual";
      readonly ordinaryFallback?: TextureAssetUploadRef;
      readonly state: VirtualTextureRuntimeState;
    };

export type VirtualTextureDrawDemandModelSource =
  | { readonly kind: "composed"; readonly localModels: readonly Mat4[]; readonly rootModels: readonly Mat4[] }
  | { readonly kind: "single"; readonly model: Mat4 };

export type VirtualTextureDrawDemandContext = {
  readonly modelSource: VirtualTextureDrawDemandModelSource;
  readonly projection: Mat4;
  readonly provider: VirtualTextureCoverageProvider;
  readonly textureCoordinates?: GltfTextureCoordinates;
  readonly view: Mat4;
  readonly viewportSize: ViewportSize;
  /** Sampler addressing used by both demand projection and the VT shader. */
  readonly wrapS?: TextureSamplerWrap;
  /** Sampler addressing used by both demand projection and the VT shader. */
  readonly wrapT?: TextureSamplerWrap;
};

export type VirtualTextureScreenFootprint = {
  readonly maxU: number;
  readonly maxV: number;
  readonly minU: number;
  readonly minV: number;
  readonly screenHeight: number;
  readonly screenWidth: number;
};

export type VirtualTextureDrawDemand = {
  /** Sampler addressing crossed a discontinuity; demand uses bounded conservative refinement. */
  readonly addressingConservative?: true;
  readonly coverageCandidates?: readonly VirtualTexturePageId[];
  readonly demandCandidates: readonly VirtualTexturePageId[];
  readonly preferredCandidates?: readonly VirtualTexturePageId[];
  /** Fixed retained-polygon workspace overflowed; demand uses bounded conservative refinement. */
  readonly retentionOverflowed?: true;
  /** The visible surface occupies most of one viewport axis and needs a broader active quality window. */
  readonly viewportDominant?: true;
};

export const virtualTextureDemandPageDistance = (
  page: VirtualTexturePageId,
  centerX: number,
  centerY: number,
): number => {
  const pageCenterX = page.x + 0.5;
  const pageCenterY = page.y + 0.5;
  return (pageCenterX - centerX) ** 2 + (pageCenterY - centerY) ** 2;
};
