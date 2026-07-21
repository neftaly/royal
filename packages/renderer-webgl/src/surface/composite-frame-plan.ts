import type { Mat4 } from "../math/mat4";
import type { FrameViewport } from "../frame/clear-frame";
import type { CanonicalSurfaceMaterial } from "./canonical-material";
import { canonicalTransmissionSceneColorRoughness } from "./surface-pass-plan";
import {
  terminalPresentationRequested,
  type LinearCompositeCapabilities,
} from "./terminal-presentation-plan";
import {
  frustumPlanesInto,
  worldBoundsVisible,
  type WorldBounds,
} from "./surface-visibility";

export type CompositeFramePlanSurface = Readonly<{
  material: CanonicalSurfaceMaterial;
  worldBounds: WorldBounds;
}>;

export type CompositeFramePlanView = Readonly<{
  viewProjection: Mat4;
  viewport: FrameViewport;
}>;

export type CompositeFramePlanWorkspace = {
  compositeRequested: boolean;
  readonly frustumPlanes: Float32Array;
  height: number;
  sceneColorMaxRoughness: number;
  terminalPresentation: boolean;
  transmissionRequested: boolean;
  visibility: Uint8Array;
  visibilityStride: number;
  width: number;
};

/** Allocates one retained per-root workspace for stereo composite planning. */
export const createCompositeFramePlanWorkspace = (): CompositeFramePlanWorkspace => ({
  compositeRequested: false,
  frustumPlanes: new Float32Array(24),
  height: 1,
  sceneColorMaxRoughness: 0,
  terminalPresentation: false,
  transmissionRequested: false,
  visibility: new Uint8Array(0),
  visibilityStride: 0,
  width: 1,
});

/**
 * Resolves stereo visibility and composite demand into caller-retained storage.
 * Visibility is dense by view and transmission-candidate slot.
 */
export const planCompositeFrameInto = (
  surfaces: readonly CompositeFramePlanSurface[],
  views: readonly CompositeFramePlanView[],
  transmissionCandidateIndices: readonly number[],
  allMaterialsStandard: boolean,
  hasAlphaBlend: boolean,
  capabilities: LinearCompositeCapabilities,
  output: CompositeFramePlanWorkspace,
): void => {
  const visibilityStride = transmissionCandidateIndices.length;
  const visibilityLength = visibilityStride * views.length;
  if (output.visibility.length < visibilityLength) {
    output.visibility = new Uint8Array(visibilityLength);
  }
  output.visibilityStride = visibilityStride;
  output.transmissionRequested = false;
  output.sceneColorMaxRoughness = 0;
  for (let viewIndex = 0; viewIndex < views.length; viewIndex += 1) {
    const view = views[viewIndex]!;
    frustumPlanesInto(output.frustumPlanes, view.viewProjection);
    const visibilityOffset = viewIndex * visibilityStride;
    for (let slot = 0; slot < visibilityStride; slot += 1) {
      const surface = surfaces[transmissionCandidateIndices[slot]!]!;
      const visible = worldBoundsVisible(surface.worldBounds, output.frustumPlanes);
      output.visibility[visibilityOffset + slot] = visible ? 1 : 0;
      if (!visible) continue;
      output.transmissionRequested = true;
      output.sceneColorMaxRoughness = Math.max(
        output.sceneColorMaxRoughness,
        canonicalTransmissionSceneColorRoughness(surface.material),
      );
    }
  }
  output.terminalPresentation = terminalPresentationRequested(
    allMaterialsStandard,
    hasAlphaBlend,
    capabilities,
    surfaces.length,
  );
  output.compositeRequested = output.transmissionRequested || output.terminalPresentation;
  output.width = 1;
  output.height = 1;
  if (!output.compositeRequested) return;
  for (const view of views) {
    output.width = Math.max(output.width, view.viewport.width);
    output.height = Math.max(output.height, view.viewport.height);
  }
};
