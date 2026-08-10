import { objectWithAllowedFields } from './descriptor-values';
import type { MeshNode } from './mesh';
import type { OutlineGltfNode } from './outline-gltf';
import {
  validateScreenSpaceSegment,
  type ScreenSpaceSegmentNode,
} from './screen-space-segment';

export type SceneOverlayNode = MeshNode | OutlineGltfNode | ScreenSpaceSegmentNode;

/** Independently replaceable, non-picking world geometry presented above the scene. */
export interface SceneOverlay {
  readonly kind: 'scene-overlay';
  readonly nodes: readonly SceneOverlayNode[];
}

export interface SceneOverlayOptions {
  /** World-space presentation nodes; authored order is retained within each node kind. */
  readonly nodes: readonly SceneOverlayNode[];
}

const SCENE_OVERLAY_FIELDS = ['nodes'] as const;

/** Creates one independently published world-space presentation overlay. */
export const sceneOverlay = (options: SceneOverlayOptions): SceneOverlay => {
  objectWithAllowedFields(options, SCENE_OVERLAY_FIELDS, 'scene overlay');
  if (!Array.isArray(options.nodes)) {
    throw new TypeError('scene overlay nodes must be an array');
  }
  const nodes = options.nodes.map((node, index) => {
    if (typeof node !== 'object' || node === null) {
      throw new TypeError(
        `scene overlay nodes[${index}] must be a mesh, screen-space segment, or outline glTF`,
      );
    }
    if (node.kind === 'outline-gltf') {
      if (node.material.kind !== 'edge') {
        throw new TypeError(`scene overlay nodes[${index}] must use an edge material`);
      }
      return node;
    }
    if (node.kind === 'screen-space-segment') {
      validateScreenSpaceSegment(node, `scene overlay nodes[${index}]`);
      return node;
    }
    if (node.kind !== 'mesh') {
      throw new TypeError(
        `scene overlay nodes[${index}] must be a mesh, screen-space segment, or outline glTF`,
      );
    }
    if (node.material.kind === 'standard') {
      throw new TypeError(`scene overlay nodes[${index}] must use an unlit or wireframe material`);
    }
    if (node.material.baseColor.kind !== 'solid') {
      throw new TypeError(`scene overlay nodes[${index}] must use a solid-color material`);
    }
    if (node.pickingGeometry !== undefined || node.pickingId !== undefined) {
      throw new TypeError(`scene overlay nodes[${index}] cannot participate in picking`);
    }
    return node;
  });
  return { kind: 'scene-overlay', nodes };
};
