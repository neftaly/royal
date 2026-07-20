import type { PickingId, Scene } from "@royal/renderer-core";
import {
  validateScenePointerEventHandlers,
  type ScenePointerEventHandlers,
  type ScenePointerEventTarget,
} from "./picking-events";

/** React-owned pointer handlers keyed by stable `pickingId` values declared in the scene. */
export type ScenePointerEvents = Readonly<Record<PickingId, ScenePointerEventHandlers>>;

export interface ScenePointerEventRegistry {
  readonly hasHoverEventTargets: boolean;
  readonly hasPointerEventTargets: boolean;
  pointerEventTarget(pickingId: string | undefined): ScenePointerEventTarget | undefined;
}

export interface ScenePickingIndex {
  count(pickingId: string): number;
}

export const createScenePickingIndex = (scene: Scene): ScenePickingIndex => {
  const counts = new Map<string, number>();
  for (const node of scene.nodes) {
    if (node.kind !== "mesh" && node.kind !== "gltf" && node.kind !== "gltf-instances") continue;
    if (node.pickingId === undefined) continue;
    counts.set(node.pickingId, (counts.get(node.pickingId) ?? 0) + 1);
  }
  return { count: (pickingId) => counts.get(pickingId) ?? 0 };
};

export const createScenePointerEventRegistry = (
  pickingIndex: ScenePickingIndex,
  interactions: ScenePointerEvents | undefined,
): ScenePointerEventRegistry => {
  if (interactions !== undefined && (
    typeof interactions !== "object"
    || interactions === null
    || Array.isArray(interactions)
  )) {
    throw new TypeError("Canvas scenePointerEvents must be an object keyed by pickingId");
  }
  const targets = new Map<string, ScenePointerEventTarget>();
  let hasHoverEventTargets = false;

  for (const [pickingId, handlers] of Object.entries(interactions ?? {})) {
    validateScenePointerEventHandlers(
      handlers,
      `Canvas scenePointerEvents[${JSON.stringify(pickingId)}]`,
    );
    const count = pickingIndex.count(pickingId);
    if (count === 0) {
      throw new Error(
        `Canvas interaction ${JSON.stringify(pickingId)} requires one scene node with the same pickingId`,
      );
    }
    if (count !== 1) {
      throw new Error(
        `Canvas interaction ${JSON.stringify(pickingId)} is ambiguous because ${count} scene nodes use that pickingId`,
      );
    }
    targets.set(pickingId, { handlers });
    hasHoverEventTargets ||= handlers.onPointerEnter !== undefined
      || handlers.onPointerLeave !== undefined
      || handlers.onPointerMove !== undefined;
  }

  return {
    hasHoverEventTargets,
    hasPointerEventTargets: targets.size > 0,
    pointerEventTarget: (pickingId) => pickingId === undefined ? undefined : targets.get(pickingId),
  };
};
