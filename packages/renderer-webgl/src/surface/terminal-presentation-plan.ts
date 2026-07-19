export type LinearCompositeCapabilities = Readonly<{
  hasFloatBlendTarget: boolean;
  hasFloatColorTarget: boolean;
}>;

/** Chooses the retained linear attachment format before resource admission. */
export const linearCompositeColorBytesPerPixel = (
  capabilities: LinearCompositeCapabilities,
  requireFloatBlend: boolean,
): 4 | 8 => capabilities.hasFloatColorTarget
  && (!requireFloatBlend || capabilities.hasFloatBlendTarget)
  ? 8
  : 4;

/**
 * Selects the optional one-shot terminal presentation path.
 *
 * PBR-neutral is safe to move out of material shaders only when every material
 * produces linear scene color. Float blending is needed only when the scene
 * actually contains an alpha-blended draw.
 */
export const terminalPresentationRequested = (
  toneMapping: "linear-clamp" | "pbr-neutral",
  allMaterialsStandard: boolean,
  hasAlphaBlend: boolean,
  capabilities: LinearCompositeCapabilities,
): boolean => toneMapping === "pbr-neutral"
  && allMaterialsStandard
  && capabilities.hasFloatColorTarget
  && (!hasAlphaBlend || capabilities.hasFloatBlendTarget);
