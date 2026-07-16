import type { RoyalRendererRoot } from "../root";
import { royalRendererCapabilitiesFor } from "../renderer-capabilities";
import type {
  XrSession,
  XrSessionRenderer,
  XrSessionRendererOptions,
} from "./renderer-model";
import { validateXrSessionRendererOptions } from "./renderer-model";

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
} from "./renderer-model";

export const createXrSessionRenderer = async (
  root: RoyalRendererRoot,
  session: XrSession,
  options?: XrSessionRendererOptions,
): Promise<XrSessionRenderer> => {
  validateXrSessionRendererOptions(options);
  const { createWebXrSessionRenderer } = await import("@royal/renderer-webgl/webxr");
  return createWebXrSessionRenderer(
    royalRendererCapabilitiesFor(root).webGlRoot,
    session,
    options,
  );
};
