import type { RoyalRendererRoot } from "./root";
import { royalRendererCapabilitiesFor } from "./renderer-capabilities";
import type {
  XrSession,
  XrSessionRenderer,
  XrSessionRendererOptions,
} from "./xr-renderer-model";

export type {
  XrFrame,
  XrFrameCallback,
  XrReferenceSpace,
  XrReferenceSpaceType,
  XrSession,
  XrSessionRenderer,
  XrSessionRendererFrameSnapshot,
  XrSessionRendererOptions,
  XrWebGlLayerOptions,
  XrView,
  XrViewerPose,
} from "./xr-renderer-model";

export const createXrSessionRenderer = async (
  root: RoyalRendererRoot,
  session: XrSession,
  options?: XrSessionRendererOptions,
): Promise<XrSessionRenderer> => {
  return royalRendererCapabilitiesFor(root).createXrSessionRenderer(session, options);
};
