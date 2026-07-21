export type LinearCompositeCapabilities = Readonly<{
  hasFloatBlendTarget: boolean;
  hasFloatColorTarget: boolean;
}>;

/** Physical-device crossover guard for amortizing one retained terminal pass. */
export const OPAQUE_TERMINAL_PRESENTATION_SURFACE_THRESHOLD = 32;

/** Chooses the retained linear attachment format before resource admission. */
export const linearCompositeColorBytesPerPixel = (
  capabilities: LinearCompositeCapabilities,
  requireFloatBlend: boolean,
): 4 | 8 => capabilities.hasFloatColorTarget
  && (!requireFloatBlend || capabilities.hasFloatBlendTarget)
  ? 8
  : 4;

/**
 * Selects the retained linear target needed for correct standard-material
 * blending or for amortized complex-scene output conversion. Small opaque
 * scenes stay direct; the decision is cold scene data, never frame timing.
 */
export const terminalPresentationRequested = (
  allMaterialsStandard: boolean,
  hasAlphaBlend: boolean,
  capabilities: LinearCompositeCapabilities,
  surfaceCount = 0,
): boolean => allMaterialsStandard
  && capabilities.hasFloatColorTarget
  && (hasAlphaBlend
    ? capabilities.hasFloatBlendTarget
    : surfaceCount >= OPAQUE_TERMINAL_PRESENTATION_SURFACE_THRESHOLD);
