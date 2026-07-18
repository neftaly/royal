import {
  type Camera,
  type PickInput,
  type PickResult,
} from "@royal/renderer-core";
import { identityMat4, inverseMat4Into, type Mat4 } from "../math/mat4";
import {
  createCanonicalPickingScratch,
  pickCanonicalSurfaceInto,
  type CanonicalPickRay,
} from "./picking-query";
import type { CanonicalSurfaceScene } from "./scene-lowering";

type CanvasClientRect = Readonly<{
  height: number;
  left: number;
  top: number;
  width: number;
}>;

type MutablePickRay = {
  direction: [number, number, number];
  maxDistance: number;
  minDistance: number;
  origin: [number, number, number];
};

const unprojectInto = (
  target: [number, number, number],
  inverse: Mat4,
  x: number,
  y: number,
  z: number,
): boolean => {
  const w = inverse[3] * x + inverse[7] * y + inverse[11] * z + inverse[15];
  if (w === 0 || !Number.isFinite(w)) return false;
  target[0] = (inverse[0] * x + inverse[4] * y + inverse[8] * z + inverse[12]) / w;
  target[1] = (inverse[1] * x + inverse[5] * y + inverse[9] * z + inverse[13]) / w;
  target[2] = (inverse[2] * x + inverse[6] * y + inverse[10] * z + inverse[14]) / w;
  return Number.isFinite(target[0]) && Number.isFinite(target[1]) && Number.isFinite(target[2]);
};

/** Owns bounded scratch; all scene intersection remains in the pure canonical query. */
export class SurfacePicker {
  readonly #hit = { distance: 0, surfaceIndex: -1 };
  readonly #inverseViewProjection = identityMat4();
  readonly #near: [number, number, number] = [0, 0, 0];
  readonly #far: [number, number, number] = [0, 0, 0];
  readonly #ray: MutablePickRay = {
    direction: [0, 0, -1],
    maxDistance: 0,
    minDistance: 0,
    origin: [0, 0, 0],
  };
  readonly #scratch = createCanonicalPickingScratch();

  pick(
    input: PickInput,
    scene: CanonicalSurfaceScene,
    viewProjection: Mat4,
    rect: CanvasClientRect,
  ): PickResult | undefined {
    const ray = this.#canvasRay(input, scene.camera, viewProjection, rect);
    if (ray === undefined) return undefined;
    if (!pickCanonicalSurfaceInto(this.#hit, ray, scene.surfaces, this.#scratch)) return undefined;
    const surface = scene.surfaces[this.#hit.surfaceIndex]!;
    const distance = this.#hit.distance;
    return {
      clientX: input.clientX,
      clientY: input.clientY,
      distance,
      point: [
        ray.origin[0] + ray.direction[0] * distance,
        ray.origin[1] + ray.direction[1] * distance,
        ray.origin[2] + ray.direction[2] * distance,
      ],
      target: {
        kind: "mesh",
        node: surface.node,
        ...(surface.node.pickingId === undefined ? {} : { pickingId: surface.node.pickingId }),
      },
    };
  }

  #canvasRay(
    input: PickInput,
    camera: Camera,
    viewProjection: Mat4,
    rect: CanvasClientRect,
  ): CanonicalPickRay | undefined {
    if (!(rect.width > 0 && rect.height > 0)) return undefined;
    const relativeX = (input.clientX - rect.left) / rect.width;
    const relativeY = (input.clientY - rect.top) / rect.height;
    if (relativeX < 0 || relativeX > 1 || relativeY < 0 || relativeY > 1) return undefined;
    const inverse = inverseMat4Into(this.#inverseViewProjection, viewProjection);
    if (inverse === undefined) return undefined;
    const ndcX = relativeX * 2 - 1;
    const ndcY = 1 - relativeY * 2;
    if (
      !unprojectInto(this.#near, inverse, ndcX, ndcY, -1)
      || !unprojectInto(this.#far, inverse, ndcX, ndcY, 1)
    ) return undefined;
    const origin = this.#ray.origin;
    if (camera.kind === "perspective-camera") {
      origin[0] = camera.position[0];
      origin[1] = camera.position[1];
      origin[2] = camera.position[2];
    } else {
      origin[0] = this.#near[0];
      origin[1] = this.#near[1];
      origin[2] = this.#near[2];
    }
    const x = this.#far[0] - origin[0];
    const y = this.#far[1] - origin[1];
    const z = this.#far[2] - origin[2];
    const length = Math.hypot(x, y, z);
    if (!(length > 0) || !Number.isFinite(length)) return undefined;
    const direction = this.#ray.direction;
    direction[0] = x / length;
    direction[1] = y / length;
    direction[2] = z / length;
    this.#ray.minDistance = camera.kind === "perspective-camera"
      ? Math.max(0,
        (this.#near[0] - origin[0]) * direction[0]
        + (this.#near[1] - origin[1]) * direction[1]
        + (this.#near[2] - origin[2]) * direction[2])
      : 0;
    this.#ray.maxDistance = length;
    return this.#ray;
  }
}
