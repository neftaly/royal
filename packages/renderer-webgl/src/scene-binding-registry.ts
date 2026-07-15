import type {
  Camera,
  CameraViewReadTarget,
  CameraViewResource,
  EulerRads,
  RenderNode,
  RenderObjectHandle,
  RenderObjectRef,
  Transform,
  Vec3,
} from "@royal/renderer-core";
import { captureFirstFailure, type CapturedFailure } from "./captured-failure";
import {
  attachRenderObjectRef,
  readRenderObjectHandleTransform,
  type RenderObjectRefAttachment,
} from "@royal/renderer-core/render-object";
import type {
  CountedReferenceDelta,
  FramePlan,
  FramePlanRenderObjectRefRow,
} from "./frame/plan";

type CameraViewResourceSubscription = {
  readonly resource: CameraViewResource;
  readonly unsubscribe: () => void;
};

type RenderObjectBinding = {
  readonly attachment: RenderObjectRefAttachment;
  declarativeTransform: Transform;
  readonly handle: RenderObjectHandle;
  node: TransformableRenderNode;
};

type TransformableRenderNode = Extract<RenderNode, { readonly kind: "gltf" | "mesh" }>;

const IDENTITY_TRANSFORM: Transform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

const cloneEulerRads = (value: EulerRads): EulerRads => [value[0], value[1], value[2]];
const cloneVec3 = (value: Vec3): Vec3 => [value[0], value[1], value[2]];

const resolvedTransform = (transform: Transform | undefined): Transform => ({
  position: cloneVec3(transform?.position ?? IDENTITY_TRANSFORM.position),
  rotation: cloneEulerRads(transform?.rotation ?? IDENTITY_TRANSFORM.rotation),
  scale: cloneVec3(transform?.scale ?? IDENTITY_TRANSFORM.scale),
});

const sameVec3 = (left: Vec3, right: Vec3): boolean =>
  Object.is(left[0], right[0])
  && Object.is(left[1], right[1])
  && Object.is(left[2], right[2]);

const sameTransform = (left: Transform, right: Transform): boolean =>
  sameVec3(left.position, right.position)
  && sameVec3(left.rotation, right.rotation)
  && sameVec3(left.scale, right.scale);

/**
 * Owns every fallible external attachment derived from the current frame plan.
 * Failed releases remain registered so a later reconciliation or disposal can
 * retry the exact owner instead of losing the only release handle.
 */
export class SceneBindingRegistry {
  readonly #cameraView: CameraViewReadTarget = {
    kind: "perspective-camera",
    position: new Float64Array(3),
    rotation: new Float64Array(3),
    fovY: 1,
    left: -1,
    right: 1,
    bottom: -1,
    top: 1,
    near: 0.1,
    far: 100,
  };
  #cameraSubscription: CameraViewResourceSubscription | undefined;
  readonly #bindings = new Map<RenderObjectRef, RenderObjectBinding>();
  readonly #handles = new WeakMap<TransformableRenderNode, RenderObjectHandle>();
  readonly #invalidate: () => void;

  constructor(invalidate: () => void) {
    this.#invalidate = invalidate;
  }

  readCamera(source: Camera | CameraViewResource): Camera | CameraViewReadTarget {
    if (source.kind !== "camera-view-resource") return source;
    source.read(this.#cameraView);
    return this.#cameraView;
  }

  reconcile(
    plan: Pick<FramePlan, "camera" | "nodes" | "renderObjectRefRows">,
    releasedRefs: readonly CountedReferenceDelta<RenderObjectRef>[],
  ): void {
    let firstFailure = captureFirstFailure(undefined, () => this.#reconcileCamera(plan.camera));
    firstFailure = captureFirstFailure(firstFailure, () => {
      this.#reconcileRenderObjects(plan.nodes, plan.renderObjectRefRows, releasedRefs);
    });
    if (firstFailure !== undefined) throw firstFailure.value;
  }

  handle(node: TransformableRenderNode): RenderObjectHandle | undefined {
    return this.#handles.get(node);
  }

  transform(node: TransformableRenderNode): Transform | undefined {
    const handle = this.#handles.get(node);
    return handle === undefined ? node.transform : readRenderObjectHandleTransform(handle);
  }

  dispose(): void {
    let firstFailure: CapturedFailure | undefined;
    const cameraSubscription = this.#cameraSubscription;
    if (cameraSubscription !== undefined) {
      firstFailure = captureFirstFailure(firstFailure, () => {
        cameraSubscription.unsubscribe();
        if (this.#cameraSubscription === cameraSubscription) this.#cameraSubscription = undefined;
      });
    }
    for (const [ref, binding] of this.#bindings) {
      firstFailure = captureFirstFailure(firstFailure, () => {
        binding.attachment.detach();
        this.#handles.delete(binding.node);
        this.#bindings.delete(ref);
      });
    }
    if (firstFailure !== undefined) throw firstFailure.value;
  }

  #reconcileCamera(resource: FramePlan["camera"]): void {
    const next = resource.kind === "camera-view-resource" ? resource : undefined;
    if (this.#cameraSubscription?.resource === next) return;
    const previous = this.#cameraSubscription;
    if (previous !== undefined) {
      previous.unsubscribe();
      if (this.#cameraSubscription === previous) this.#cameraSubscription = undefined;
    }
    if (next === undefined) return;
    const unsubscribe = next.subscribe(() => this.#invalidate());
    this.#cameraSubscription = { resource: next, unsubscribe };
  }

  #reconcileRenderObjects(
    nodes: readonly RenderNode[],
    rows: readonly FramePlanRenderObjectRefRow[],
    releasedRefs: readonly CountedReferenceDelta<RenderObjectRef>[],
  ): void {
    let firstFailure: CapturedFailure | undefined;
    for (const row of rows) {
      const node = nodes[row.nodeIndex];
      if (node?.kind !== "mesh" && node?.kind !== "gltf") continue;
      firstFailure = captureFirstFailure(firstFailure, () => this.#syncRenderObject(node));
    }
    for (const row of releasedRefs) {
      if (row.nextCount !== 0) continue;
      const binding = this.#bindings.get(row.resource);
      if (binding === undefined) continue;
      firstFailure = captureFirstFailure(firstFailure, () => {
        binding.attachment.detach();
        this.#handles.delete(binding.node);
        this.#bindings.delete(row.resource);
      });
    }
    if (firstFailure !== undefined) throw firstFailure.value;
  }

  #syncRenderObject(node: TransformableRenderNode): void {
    if (node.ref === undefined) return;
    const ref = node.ref;
    const declarativeTransform = resolvedTransform(node.transform);
    let binding = this.#bindings.get(ref);
    if (binding === undefined) {
      const attachment = attachRenderObjectRef(ref, declarativeTransform, this.#invalidate);
      binding = {
        attachment,
        declarativeTransform,
        handle: attachment.handle,
        node,
      };
      this.#bindings.set(ref, binding);
      this.#handles.set(node, binding.handle);
      return;
    }
    if (!sameTransform(binding.declarativeTransform, declarativeTransform)) {
      binding.attachment.syncTransform(declarativeTransform);
      binding.declarativeTransform = declarativeTransform;
    }
    this.#handles.delete(binding.node);
    binding.node = node;
    this.#handles.set(node, binding.handle);
  }
}
