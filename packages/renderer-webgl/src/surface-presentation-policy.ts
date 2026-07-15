import type { RenderToneMapping } from "@royal/renderer-core";

export interface SurfacePresentationPlan {
  readonly exposureEv100: number | undefined;
  readonly toneMapping: RenderToneMapping | undefined;
}

export interface SurfaceToneMappingState {
  readonly exposure: number;
  readonly hdrOutput: boolean;
  readonly toneMapping: RenderToneMapping;
}

type MutableSurfaceToneMappingState = {
  -readonly [Key in keyof SurfaceToneMappingState]: SurfaceToneMappingState[Key];
};

const DEFAULT_EXPOSURE = 1 / 1.2;
const DEFAULT_TONE_MAPPING: RenderToneMapping = "pbr-neutral";
const TONE_MAPPING_SHADER_MODES: Readonly<Record<RenderToneMapping, 0 | 1>> = {
  "linear-clamp": 0,
  "pbr-neutral": 1,
};

/** Pure policy: only scene-linear composition needs an HDR intermediate. */
export const surfacePresentationRequiresHdr = (
  hasHdrCompositionAsset: boolean,
): boolean => hasHdrCompositionAsset;

/** Writes public EV100/display-transform inputs into retained shader state. */
export const writeSurfaceToneMappingState = (
  output: MutableSurfaceToneMappingState,
  scene: Pick<SurfacePresentationPlan, "exposureEv100" | "toneMapping">,
  hdrOutput: boolean,
): SurfaceToneMappingState => {
  output.exposure = scene.exposureEv100 === undefined
    ? DEFAULT_EXPOSURE
    : 1 / (1.2 * 2 ** scene.exposureEv100);
  output.hdrOutput = hdrOutput;
  output.toneMapping = scene.toneMapping ?? DEFAULT_TONE_MAPPING;
  return output;
};

/** Pure allocation-owning convenience form for policy tests and callers. */
export const resolveSurfaceToneMapping = (
  scene: Pick<SurfacePresentationPlan, "exposureEv100" | "toneMapping">,
  hdrOutput: boolean,
): SurfaceToneMappingState => writeSurfaceToneMappingState(
  { exposure: 0, hdrOutput: false, toneMapping: DEFAULT_TONE_MAPPING },
  scene,
  hdrOutput,
);

/** Stable numeric ABI shared by material and postprocess shaders. */
export const toneMappingShaderMode = (toneMapping: RenderToneMapping): 0 | 1 =>
  TONE_MAPPING_SHADER_MODES[toneMapping];
