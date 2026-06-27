import type { DirectionalLightNode } from './directional-light';
import type { GltfNode } from './gltf';
import type { MeshNode } from './mesh';
import type { VectorTextNode } from './text';

export type RenderNode = MeshNode | GltfNode | DirectionalLightNode | VectorTextNode;
