import { objectWithAllowedFields } from './descriptor-values';
import type { MeshNode } from './mesh';

/** Independently replaceable, non-picking world geometry presented above the scene. */
export interface SceneOverlay {
  readonly kind: 'scene-overlay';
  readonly nodes: readonly MeshNode[];
}

export interface SceneOverlayOptions {
  /** Ordered direct meshes. Overlay geometry is frustum-clipped but never depth-occluded. */
  readonly nodes: readonly MeshNode[];
}

const SCENE_OVERLAY_FIELDS = ['nodes'] as const;

/** Creates one independently published world-space presentation overlay. */
export const sceneOverlay = (options: SceneOverlayOptions): SceneOverlay => {
  objectWithAllowedFields(options, SCENE_OVERLAY_FIELDS, 'scene overlay');
  if (!Array.isArray(options.nodes)) {
    throw new TypeError('scene overlay nodes must be an array');
  }
  const nodes = options.nodes.map((node, index) => {
    if (typeof node !== 'object' || node === null || node.kind !== 'mesh') {
      throw new TypeError(`scene overlay nodes[${index}] must be a mesh`);
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
