import type { LinearCompositeCapabilities } from './terminal-presentation-plan';

export type BoundedVolumePresentationMode = 'none' | 'direct' | 'linear' | 'omitted';

/**
 * Keeps bounded-volume activation from silently changing an established
 * surface presentation path or reducing a retained HDR target to RGBA8.
 */
export const boundedVolumePresentationMode = (
  visible: boolean,
  linearCompositeAlreadyRequested: boolean,
  capabilities: LinearCompositeCapabilities,
): BoundedVolumePresentationMode => {
  if (!visible) return 'none';
  if (!linearCompositeAlreadyRequested) return 'direct';
  return capabilities.hasFloatColorTarget && !capabilities.hasFloatBlendTarget
    ? 'omitted'
    : 'linear';
};
