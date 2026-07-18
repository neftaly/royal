import {
  transformGltfAssetBounds,
  type GltfNode,
  type Metres,
  type Rads,
} from "@royal/renderer-core";
import { useLayoutEffect, type ReactNode } from "react";
import { useCanvasSize } from "../canvas-size";
import { useGltfAssetStatus } from "../gltf-status";
import type { OrbitCameraController } from "./camera-controller";

/** Declarative responsive framing for one glTF asset and orbit controller. */
export interface GltfOrbitCameraFitProps {
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
 * preserved unless `pitch` or `yaw` is supplied, and the controller's far
 * plane expands when necessary to keep the fitted asset inside the frustum.
 */
export const GltfOrbitCameraFit = ({
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
  const bounds = status.state === "idle"
    ? node.asset.bounds
    : status.bounds ?? node.asset.bounds;
  const fitKey = bounds === undefined || size === undefined ? undefined : JSON.stringify([
    node.asset.src, node.asset.version, bounds.min, bounds.max, node.transform,
    size.aspectRatio, fovY, minDistance, padding, pitch, yaw,
  ]);

  useLayoutEffect(() => {
    if (fitKey === undefined || bounds === undefined || size === undefined) return;
    const current = orbit.getView();
    orbit.fit(transformGltfAssetBounds(bounds, node.transform), {
      aspectRatio: size.aspectRatio,
      ...(fovY === undefined ? {} : { fovY }),
      ...(minDistance === undefined ? {} : { minDistance }),
      ...(padding === undefined ? {} : { padding }),
      pitch: pitch ?? current.pitch,
      yaw: yaw ?? current.yaw,
    });
  // The semantic key prevents image-progress snapshots from resetting a camera.
  }, [fitKey, orbit]);

  return null;
};
