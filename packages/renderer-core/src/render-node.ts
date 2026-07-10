import type { DirectionalLightNode } from './directional-light';
import type { GltfNode } from './gltf';
import type { GltfInstancesNode } from './gltf-instances';
import type { MeshNode } from './mesh';
import type { TextNode } from './text/types';

export type RenderNode = MeshNode | GltfNode | GltfInstancesNode | DirectionalLightNode | TextNode;
