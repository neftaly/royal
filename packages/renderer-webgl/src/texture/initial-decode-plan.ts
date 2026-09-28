import { identityMat4, multiplyMat4Into, projectionMat4Into, viewMat4Into, type Mat4 } from "../math/mat4";
import type { CanonicalSurfaceScene } from "../surface/scene-lowering";
import type { WorldBounds } from "../surface/surface-visibility";
import { decodedTextureKey } from "./source";
import { ordinaryTextureStorageBytes } from "./storage";

const projectedDecodeBytes = (bounds: WorldBounds, matrix: Mat4, width: number, height: number): number => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let frontCorners = 0;
  let outsidePlanes = 63;
  for (let corner = 0; corner < 8; corner++) {
    const x = (corner & 1 ? bounds.max : bounds.min)[0];
    const y = (corner & 2 ? bounds.max : bounds.min)[1];
    const z = (corner & 4 ? bounds.max : bounds.min)[2];
    const w = matrix[3]! * x + matrix[7]! * y + matrix[11]! * z + matrix[15]!;
    const cx = matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!;
    const cy = matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!;
    const cz = matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!;
    // Reject only when every corner is outside the same homogeneous clip plane.
    // Checking before division also handles bounds crossing the eye plane.
    outsidePlanes &= (cx < -w ? 1 : 0) | (cx > w ? 2 : 0)
      | (cy < -w ? 4 : 0) | (cy > w ? 8 : 0)
      | (cz < -w ? 16 : 0) | (cz > w ? 32 : 0);
    if (!(w > 1e-6)) continue;
    frontCorners++;
    const sx = cx / w;
    const sy = cy / w;
    minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
    minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
  }
  // A hint never reduces the existing seed. Clip projected extent to the view
  // and round upward to avoid a slightly undersized first decode.
  const pixels = outsidePlanes !== 0 || frontCorners === 0 ? 0 : frontCorners < 8 ? Math.max(width, height) : Math.max(
    Math.max(0, Math.min(1, maxX) - Math.max(-1, minX)) * width / 2,
    Math.max(0, Math.min(1, maxY) - Math.max(-1, minY)) * height / 2);
  const edge = Math.min(2048, 2 ** Math.ceil(Math.log2(Math.max(256, pixels))));
  return ordinaryTextureStorageBytes(edge, edge, true);
};

/** Camera-sized seed hints, not a substitute for exact UV/mip demand. */
export const planInitialTextureDecodeBytes = (
  scene: CanonicalSurfaceScene, width: number, height: number,
): ReadonlyMap<string, number> => {
  const projection = identityMat4(), view = identityMat4(), matrix = identityMat4();
  projectionMat4Into(projection, scene.camera, width, height);
  viewMat4Into(view, scene.camera);
  multiplyMat4Into(matrix, projection, view);
  const result = new Map<string, number>();
  const outer = identityMat4(), local = identityMat4(), combined = identityMat4();
  for (const surface of scene.surfaces) {
    const asset = surface.materialSource.baseColorAsset;
    if (asset === undefined) continue;
    let bytes = 0;
    if (surface.instances === undefined || surface.instances.count === 0) {
      bytes = projectedDecodeBytes(surface.worldBounds, matrix, width, height);
    } else {
      // The union of distant tiny instances can cover the whole screen. Size
      // the shared image for its largest use, not that union's empty space.
      multiplyMat4Into(outer, matrix, surface.model);
      for (let instance = 0; instance < surface.instances.count; instance++) {
        for (let component = 0; component < 16; component++) local[component] = surface.instances.localModels[instance * 16 + component]!;
        multiplyMat4Into(combined, outer, local);
        bytes = Math.max(bytes, projectedDecodeBytes(surface.geometry.bounds, combined, width, height));
      }
    }
    const key = decodedTextureKey(asset);
    result.set(key, Math.max(result.get(key) ?? 0, bytes));
  }
  return result;
};
