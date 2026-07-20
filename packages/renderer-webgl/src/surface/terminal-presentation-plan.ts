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
 * Selects the retained linear target needed for correct standard-material blending.
 *
 * Opaque/masked scenes present directly: measured full-screen bandwidth costs
 * more than repeating the compact output transform on their visible fragments.
 */
export const terminalPresentationRequested = (
  allMaterialsStandard: boolean,
  hasAlphaBlend: boolean,
  capabilities: LinearCompositeCapabilities,
): boolean => allMaterialsStandard
  && hasAlphaBlend
  && capabilities.hasFloatColorTarget
  && capabilities.hasFloatBlendTarget;
