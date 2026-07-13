import {
  type Camera,
  type CameraViewReadTarget,
  type GltfInstancesNode,
  type GltfNode,
  type MeshNode,
  type PickInput,
  type PickResult,
  type RenderNode,
  type Transform,
} from "@royal/renderer-core";
import type { LoadedGltfPrimitive } from "./gltf/prepared-asset";
import type { CpuGeometry } from "./geometry-recipes";
import {
  identityMat4,
  inverseMat4Into,
  multiplyMat4Into,
  projectionMat4Into,
  transformMat4Into,
  viewMat4Into,
  type Mat4,
} from "./math/mat4";
import {
  createRayGeometryScratch,
  isBoundsVisible,
  pointOnRay,
  rayAabbDistanceScalars,
  rayGeometryDistanceWithScratch,
  transformBoundsInto,
  type Bounds3,
  type MutableBounds3,
  type Ray,
  type RayGeometryMode,
} from "./math/picking";

type PickCandidate = PickResult & {
  readonly drawOrdinal: number;
};

type PickScratchCandidate = {
  readonly bounds: MutableBounds3;
  boundsDistance: number;
  instanceIndex: number;
  localModel?: Mat4;
  ordinal: number;
  outerIndex: number;
  primitive?: LoadedGltfPrimitive;
  rootModel?: Mat4;
};

export type PickingControllerDependencies = {
  readonly gltfInstanceRootModels: (node: GltfInstancesNode) => readonly Mat4[];
  readonly meshGeometry: (node: MeshNode) => CpuGeometry;
  readonly meshLocalBounds: (geometry: CpuGeometry) => Bounds3 | undefined;
  readonly preparedGltfPrimitives:
    (node: GltfNode | GltfInstancesNode) => readonly LoadedGltfPrimitive[] | undefined;
  readonly renderObjectTransform: (node: MeshNode | GltfNode) => Transform | undefined;
};

export type PickingControllerInput = {
  readonly camera: Camera | CameraViewReadTarget;
  readonly height: number;
  readonly input: PickInput;
  readonly nodes: readonly RenderNode[];
  readonly width: number;
};

export type PickingWorkSnapshot = {
  readonly candidateHighWater: number;
  readonly candidates: number;
  readonly exactTests: number;
};

const isPickableDrawMode = (mode: CpuGeometry["mode"] | undefined): boolean =>
  mode === undefined
  || mode === "triangles"
  || mode === "triangle-strip"
  || mode === "triangle-fan";

/**
 * Reusable CPU picking workspace. The renderer root supplies authoritative
 * scene/resource reads; this controller owns traversal, scratch memory, and
 * deterministic hit ordering without retaining scene nodes between calls.
 */
export class PickingController {
  readonly #canvas: HTMLCanvasElement;
  readonly #candidates: PickScratchCandidate[] = [];
  readonly #dependencies: PickingControllerDependencies;
  #candidateCount = 0;
  #candidatesThisPick = 0;
  #exactTestsThisPick = 0;
  readonly #heap: number[] = [];
  readonly #inverseViewProjection = identityMat4();
  readonly #model = identityMat4();
  readonly #projection = identityMat4();
  readonly #ray: Ray = { direction: [0, 0, -1], origin: [0, 0, 0] };
  readonly #rayGeometryScratch = createRayGeometryScratch();
  readonly #rootModel = identityMat4();
  readonly #rootViewProjection = identityMat4();
  readonly #view = identityMat4();
  readonly #viewProjection = identityMat4();

  constructor(
    canvas: HTMLCanvasElement,
    dependencies: PickingControllerDependencies,
  ) {
    this.#canvas = canvas;
    this.#dependencies = dependencies;
  }

  pick({ camera, height, input, nodes, width }: PickingControllerInput): PickResult | undefined {
    this.#candidatesThisPick = 0;
    this.#exactTestsThisPick = 0;
    const projection = projectionMat4Into(this.#projection, camera, width, height);
    const view = viewMat4Into(this.#view, camera);
    const viewProjection = multiplyMat4Into(this.#viewProjection, projection, view);
    const ray = this.#pickRayInto(input, viewProjection);
    if (ray === undefined) return undefined;

    let best: PickCandidate | undefined;
    let drawOrdinal = 0;
    for (const node of nodes) {
      let hit: PickCandidate | undefined;
      if (node.kind === "mesh") {
        hit = this.#pickMesh(node, ray, viewProjection, input, drawOrdinal);
        drawOrdinal += 1;
      } else if (node.kind === "gltf") {
        hit = this.#pickGltf(node, ray, viewProjection, input, drawOrdinal);
        drawOrdinal += 1;
      } else if (node.kind === "gltf-instances") {
        hit = this.#pickGltfInstances(node, ray, viewProjection, input, drawOrdinal);
        drawOrdinal += 1;
      }
      if (hit !== undefined && this.#isBetterPick(hit, best)) best = hit;
    }

    if (best === undefined) return undefined;
    return {
      clientX: best.clientX,
      clientY: best.clientY,
      distance: best.distance,
      point: best.point,
      target: best.target,
    };
  }

  snapshot(): PickingWorkSnapshot {
    return {
      candidateHighWater: this.#candidates.length,
      candidates: this.#candidatesThisPick,
      exactTests: this.#exactTestsThisPick,
    };
  }

  #pickRayInto(input: PickInput, viewProjection: Mat4): Ray | undefined {
    const rect = this.#canvas.getBoundingClientRect();
    const { height, width } = rect;
    if (width <= 0 || height <= 0) return undefined;

    const ndcX = ((input.clientX - rect.left) / width) * 2 - 1;
    const ndcY = 1 - ((input.clientY - rect.top) / height) * 2;
    const inverse = inverseMat4Into(this.#inverseViewProjection, viewProjection);
    if (inverse === undefined) return undefined;
    const nearW = inverse[3] * ndcX + inverse[7] * ndcY - inverse[11] + inverse[15];
    const farW = inverse[3] * ndcX + inverse[7] * ndcY + inverse[11] + inverse[15];
    if (nearW === 0 || farW === 0) return undefined;
    const origin = this.#ray.origin as [number, number, number];
    const direction = this.#ray.direction as [number, number, number];
    origin[0] = (inverse[0] * ndcX + inverse[4] * ndcY - inverse[8] + inverse[12]) / nearW;
    origin[1] = (inverse[1] * ndcX + inverse[5] * ndcY - inverse[9] + inverse[13]) / nearW;
    origin[2] = (inverse[2] * ndcX + inverse[6] * ndcY - inverse[10] + inverse[14]) / nearW;
    const farX = (inverse[0] * ndcX + inverse[4] * ndcY + inverse[8] + inverse[12]) / farW;
    const farY = (inverse[1] * ndcX + inverse[5] * ndcY + inverse[9] + inverse[13]) / farW;
    const farZ = (inverse[2] * ndcX + inverse[6] * ndcY + inverse[10] + inverse[14]) / farW;
    const x = farX - origin[0];
    const y = farY - origin[1];
    const z = farZ - origin[2];
    const length = Math.hypot(x, y, z);
    if (length === 0 || !Number.isFinite(length)) return undefined;
    direction[0] = x / length;
    direction[1] = y / length;
    direction[2] = z / length;
    return this.#ray;
  }

  #pickMesh(
    node: MeshNode,
    ray: Ray,
    viewProjection: Mat4,
    input: PickInput,
    drawOrdinal: number,
  ): PickCandidate | undefined {
    const cpu = this.#dependencies.meshGeometry(node);
    if (!isPickableDrawMode(cpu.mode)) return undefined;
    const model = transformMat4Into(this.#model, this.#dependencies.renderObjectTransform(node));
    const localBounds = this.#dependencies.meshLocalBounds(cpu);
    if (localBounds === undefined) return undefined;
    if (!isBoundsVisible(localBounds, multiplyMat4Into(this.#rootViewProjection, viewProjection, model))) {
      return undefined;
    }
    const bounds = transformBoundsInto(
      this.#candidates[0]?.bounds ?? { max: [0, 0, 0], min: [0, 0, 0] },
      localBounds,
      model,
    );
    if (this.#candidates.length === 0) {
      this.#candidates.push({
        bounds,
        boundsDistance: 0,
        instanceIndex: 0,
        ordinal: 0,
        outerIndex: 0,
      });
    }
    if (rayAabbDistanceScalars(
      ray,
      bounds.min[0], bounds.min[1], bounds.min[2],
      bounds.max[0], bounds.max[1], bounds.max[2],
    ) === undefined) return undefined;
    this.#candidatesThisPick += 1;
    this.#exactTestsThisPick += 1;
    const mode = cpu.mode === "triangle-fan" || cpu.mode === "triangle-strip" ? cpu.mode : "triangles";
    const distance = rayGeometryDistanceWithScratch(
      cpu.positions, cpu.indices, mode, model, ray, this.#rayGeometryScratch,
    );
    if (distance === undefined) return undefined;
    return {
      clientX: input.clientX,
      clientY: input.clientY,
      distance,
      drawOrdinal,
      point: pointOnRay(ray, distance),
      target: { ...(node.pickingId === undefined ? {} : { id: node.pickingId }), kind: "mesh", node },
    };
  }

  #pickGltf(
    node: GltfNode,
    ray: Ray,
    viewProjection: Mat4,
    input: PickInput,
    drawOrdinal: number,
  ): PickCandidate | undefined {
    const primitives = this.#dependencies.preparedGltfPrimitives(node);
    if (primitives === undefined) return undefined;
    const rootModel = transformMat4Into(this.#rootModel, this.#dependencies.renderObjectTransform(node));
    this.#resetCandidates();
    const rootViewProjection = multiplyMat4Into(this.#rootViewProjection, viewProjection, rootModel);
    for (const primitive of primitives) {
      if (!isPickableDrawMode(primitive.mode)) continue;
      const localModels = primitive.localModels;
      for (let instanceIndex = 0; instanceIndex < localModels.length; instanceIndex += 1) {
        const localBounds = primitive.localBounds[instanceIndex];
        if (localBounds === undefined || !isBoundsVisible(localBounds, rootViewProjection)) continue;
        this.#addCandidate(localBounds, rootModel, localModels[instanceIndex]!, primitive, -1, instanceIndex, ray);
      }
    }
    return this.#pickNearestGltfCandidate(node, ray, input, drawOrdinal);
  }

  #pickGltfInstances(
    node: GltfInstancesNode,
    ray: Ray,
    viewProjection: Mat4,
    input: PickInput,
    drawOrdinal: number,
  ): PickCandidate | undefined {
    const primitives = this.#dependencies.preparedGltfPrimitives(node);
    if (primitives === undefined) return undefined;
    const rootModels = this.#dependencies.gltfInstanceRootModels(node);
    this.#resetCandidates();
    for (const primitive of primitives) {
      if (!isPickableDrawMode(primitive.mode)) continue;
      const localModels = primitive.localModels;
      for (let outerIndex = 0; outerIndex < node.instances.count; outerIndex += 1) {
        const rootModel = rootModels[outerIndex]!;
        const rootViewProjection = multiplyMat4Into(this.#rootViewProjection, viewProjection, rootModel);
        for (let instanceIndex = 0; instanceIndex < localModels.length; instanceIndex += 1) {
          const localBounds = primitive.localBounds[instanceIndex];
          if (localBounds === undefined || !isBoundsVisible(localBounds, rootViewProjection)) continue;
          this.#addCandidate(
            localBounds, rootModel, localModels[instanceIndex]!, primitive, outerIndex, instanceIndex, ray,
          );
        }
      }
    }
    return this.#pickNearestGltfCandidate(node, ray, input, drawOrdinal);
  }

  #resetCandidates(): void {
    this.#candidateCount = 0;
    this.#heap.length = 0;
  }

  #addCandidate(
    localBounds: Bounds3,
    rootModel: Mat4,
    localModel: Mat4,
    primitive: LoadedGltfPrimitive,
    outerIndex: number,
    instanceIndex: number,
    ray: Ray,
  ): void {
    const index = this.#candidateCount;
    let candidate = this.#candidates[index];
    if (candidate === undefined) {
      candidate = {
        bounds: { max: [0, 0, 0], min: [0, 0, 0] },
        boundsDistance: 0,
        instanceIndex: 0,
        ordinal: 0,
        outerIndex: 0,
      };
      this.#candidates.push(candidate);
    }
    transformBoundsInto(candidate.bounds, localBounds, rootModel);
    const distance = rayAabbDistanceScalars(
      ray,
      candidate.bounds.min[0], candidate.bounds.min[1], candidate.bounds.min[2],
      candidate.bounds.max[0], candidate.bounds.max[1], candidate.bounds.max[2],
    );
    if (distance === undefined) return;
    candidate.boundsDistance = distance;
    candidate.instanceIndex = instanceIndex;
    candidate.localModel = localModel;
    candidate.ordinal = index;
    candidate.outerIndex = outerIndex;
    candidate.primitive = primitive;
    candidate.rootModel = rootModel;
    this.#candidateCount += 1;
    this.#candidatesThisPick += 1;
    this.#pushHeap(index);
  }

  #candidateBefore(leftIndex: number, rightIndex: number): boolean {
    const left = this.#candidates[leftIndex]!;
    const right = this.#candidates[rightIndex]!;
    return left.boundsDistance < right.boundsDistance
      || (left.boundsDistance === right.boundsDistance && left.ordinal < right.ordinal);
  }

  #pushHeap(candidateIndex: number): void {
    let index = this.#heap.length;
    this.#heap.push(candidateIndex);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.#candidateBefore(candidateIndex, this.#heap[parent]!)) break;
      this.#heap[index] = this.#heap[parent]!;
      index = parent;
    }
    this.#heap[index] = candidateIndex;
  }

  #popHeap(): number | undefined {
    const first = this.#heap[0];
    const last = this.#heap.pop();
    if (first === undefined || last === undefined || this.#heap.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.#heap.length) break;
      const right = left + 1;
      const child = right < this.#heap.length
        && this.#candidateBefore(this.#heap[right]!, this.#heap[left]!) ? right : left;
      if (!this.#candidateBefore(this.#heap[child]!, last)) break;
      this.#heap[index] = this.#heap[child]!;
      index = child;
    }
    this.#heap[index] = last;
    return first;
  }

  #pickNearestGltfCandidate(
    node: GltfNode | GltfInstancesNode,
    ray: Ray,
    input: PickInput,
    drawOrdinal: number,
  ): PickCandidate | undefined {
    let bestIndex = -1;
    let bestDistance = Infinity;
    let bestOrdinal = Infinity;
    while (this.#heap.length > 0) {
      const index = this.#popHeap();
      if (index === undefined) break;
      const candidate = this.#candidates[index]!;
      if (candidate.boundsDistance > bestDistance) break;
      const primitive = candidate.primitive;
      const rootModel = candidate.rootModel;
      const localModel = candidate.localModel;
      if (primitive === undefined || rootModel === undefined || localModel === undefined) continue;
      multiplyMat4Into(this.#model, rootModel, localModel);
      this.#exactTestsThisPick += 1;
      const mode = primitive.mode as RayGeometryMode;
      const distance = rayGeometryDistanceWithScratch(
        primitive.positions,
        primitive.indices,
        mode,
        this.#model,
        ray,
        this.#rayGeometryScratch,
      );
      if (
        distance !== undefined
        && (distance < bestDistance || (distance === bestDistance && candidate.ordinal < bestOrdinal))
      ) {
        bestDistance = distance;
        bestIndex = index;
        bestOrdinal = candidate.ordinal;
      }
    }
    if (bestIndex < 0) return undefined;
    const best = this.#candidates[bestIndex]!;
    const primitive = best.primitive!;
    const primitiveKey = primitive.localModels.length === 1
      ? primitive.key
      : node.kind === "gltf"
        ? `${primitive.key}:instance:${best.instanceIndex}`
        : `${primitive.key}:asset-instance:${best.instanceIndex}`;
    return {
      clientX: input.clientX,
      clientY: input.clientY,
      distance: bestDistance,
      drawOrdinal,
      point: pointOnRay(ray, bestDistance),
      target: node.kind === "gltf"
        ? { ...(node.pickingId === undefined ? {} : { id: node.pickingId }), kind: "gltf", node, primitiveKey }
        : {
          ...(node.pickingId === undefined ? {} : { id: node.pickingId }),
          ...(node.instances.logicalIds?.[best.outerIndex] === undefined
            ? {}
            : { instanceId: node.instances.logicalIds[best.outerIndex] }),
          instanceIndex: best.outerIndex,
          kind: "gltf-instances",
          node,
          primitiveKey,
        },
    };
  }

  #isBetterPick(candidate: PickCandidate, current: PickCandidate | undefined): boolean {
    if (current === undefined) return true;
    if (candidate.distance !== current.distance) return candidate.distance < current.distance;
    return candidate.drawOrdinal > current.drawOrdinal;
  }
}
