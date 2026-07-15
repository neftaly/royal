import type { RenderToneMapping } from "@royal/renderer-core";

export interface SurfacePresentationPlan {
  readonly environment: object | undefined;
  readonly exposureEv100: number | undefined;
  readonly lightNodes: readonly unknown[];
  readonly toneMapping: RenderToneMapping | undefined;
}

export interface SurfaceToneMappingState {
  readonly exposure: number;
  readonly hdrOutput: boolean;
  readonly toneMapping: RenderToneMapping;
}

const DEFAULT_EXPOSURE = 1 / 1.2;
const DEFAULT_TONE_MAPPING: RenderToneMapping = "pbr-neutral";
const TONE_MAPPING_SHADER_MODES: Readonly<Record<RenderToneMapping, 0 | 1 | 2>> = {
  "linear-clamp": 0,
  "aces-fitted": 1,
  "pbr-neutral": 2,
};

/** Pure scene policy deciding whether the frame requires the HDR pipeline. */
export const surfacePresentationRequiresHdr = (
  plan: SurfacePresentationPlan,
  hasHdrReadyAsset: boolean,
): boolean => plan.environment !== undefined
  || plan.exposureEv100 !== undefined
  || plan.toneMapping === "aces-fitted"
  || plan.toneMapping === "pbr-neutral"
  || plan.lightNodes.length > 0
  || hasHdrReadyAsset;

/** Resolves public EV100/display-transform inputs to shader-ready state. */
export const resolveSurfaceToneMapping = (
  scene: Pick<SurfacePresentationPlan, "exposureEv100" | "toneMapping">,
  hdrOutput: boolean,
): SurfaceToneMappingState => ({
  exposure: scene.exposureEv100 === undefined
    ? DEFAULT_EXPOSURE
    : 1 / (1.2 * 2 ** scene.exposureEv100),
  hdrOutput,
  toneMapping: scene.toneMapping ?? DEFAULT_TONE_MAPPING,
});

/** Stable numeric ABI shared by material and postprocess shaders. */
export const toneMappingShaderMode = (toneMapping: RenderToneMapping): 0 | 1 | 2 =>
  TONE_MAPPING_SHADER_MODES[toneMapping];
