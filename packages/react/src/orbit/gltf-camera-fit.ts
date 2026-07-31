import {
  transformGltfAssetBounds,
  type GltfNode,
  type Metres,
  type Rads,
} from "@royal/renderer-core";
import { useLayoutEffect, type ReactNode } from "react";
import { useCanvasSize } from "../observation/canvas-size";
import { useGltfAssetStatus } from "../observation/gltf-asset";
import type {
  OrbitCameraController,
  OrbitCameraFitClipping,
} from "./camera-controller";

/** Declarative responsive framing for one glTF asset and orbit controller. */
export interface GltfOrbitCameraFitProps {
  /**
   * `track-bounds` derives clipping from this asset after subsequent orbit
   * movement. The orbit's authored `near` remains the minimum near plane.
   * @defaultValue `"preserve"`
   */
  readonly clipping?: OrbitCameraFitClipping;
  /** Optional field of view used only for fitting; defaults to the orbit projection. */
  readonly fovY?: Rads;
  /** Lower distance clamp in metres. */
  readonly minDistance?: Metres;
  /** Exact glTF node whose prepared bounds and node transform define the framing. */
  readonly node: GltfNode;
  /** Orbit controller whose target and distance this component owns. */
  readonly orbit: OrbitCameraController;
  /** Bounding-sphere padding multiplier; `1` is a tight conservative fit. */
  readonly padding?: number;
  /** Fixed pitch in radians; omitted values preserve the current orbit pitch. */
  readonly pitch?: Rads;
  /** Fixed yaw in radians; omitted values preserve the current orbit yaw. */
  readonly yaw?: Rads;
}

/**
 * Fits an orbit camera when glTF bounds become available and whenever the
 * surrounding Canvas aspect ratio changes. The current orientation is
 * preserved unless `pitch` or `yaw` is supplied. Fixed clipping expands the
 * far plane when required; tracked clipping follows the declared bounds.
 */
export const GltfOrbitCameraFit = ({
  clipping,
  fovY,
  minDistance,
  node,
  orbit,
  padding,
  pitch,
  yaw,
}: GltfOrbitCameraFitProps): ReactNode => {
  const status = useGltfAssetStatus(node.asset);
  const size = useCanvasSize();
  const bounds = status.status === "ready"
    || status.status === "streaming"
    || status.status === "degraded"
    ? status.bounds
    : node.asset.bounds;
  const aspectRatio = size?.aspectRatio;

  useLayoutEffect(() => {
    if (bounds === undefined || aspectRatio === undefined) return;
    const current = orbit.getView();
    orbit.fit(transformGltfAssetBounds(bounds, node.transform), {
      aspectRatio,
      ...(clipping === undefined ? {} : { clipping }),
      ...(fovY === undefined ? {} : { fovY }),
      ...(minDistance === undefined ? {} : { minDistance }),
      ...(padding === undefined ? {} : { padding }),
      pitch: pitch ?? current.pitch,
      yaw: yaw ?? current.yaw,
    });
  // Scalar dependencies prevent image-progress snapshots from resetting a camera.
  }, [
    aspectRatio,
    bounds?.max[0],
    bounds?.max[1],
    bounds?.max[2],
    bounds?.min[0],
    bounds?.min[1],
    bounds?.min[2],
    clipping,
    fovY,
    minDistance,
    node.transform?.position[0],
    node.transform?.position[1],
    node.transform?.position[2],
    node.transform?.rotation[0],
    node.transform?.rotation[1],
    node.transform?.rotation[2],
    node.transform?.scale[0],
    node.transform?.scale[1],
    node.transform?.scale[2],
    orbit,
    padding,
    pitch,
    yaw,
  ]);

  return null;
};
