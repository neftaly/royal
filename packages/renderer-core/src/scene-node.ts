import type { DirectionalLightNode } from './directional-light';
import type { PointLightNode } from './point-light';
import type { SpotLightNode } from './spot-light';
import type { GltfNode } from './gltf';
import type { GltfInstancesNode } from './gltf-instances';
import type { MeshNode } from './mesh';
import type { BoundedVolumeNode } from './bounded-volume';

export type SceneNode = BoundedVolumeNode | MeshNode | GltfNode | GltfInstancesNode | DirectionalLightNode | PointLightNode | SpotLightNode;
