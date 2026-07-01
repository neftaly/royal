import type { DirectionalLightNode } from './directional-light';
import type { GltfNode } from './gltf';
import type { MeshNode } from './mesh';
import type { TextNode } from './text';

export type AutoLodGeneratedMeshes = 'off' | 'experimental';

export type AutoLodQuality = 'performance' | 'balanced' | 'quality';

export interface AutoLodNode {
  readonly children: readonly RenderNode[];
  readonly generatedMeshes: AutoLodGeneratedMeshes;
  readonly kind: 'auto-lod';
  readonly quality: AutoLodQuality;
}

export interface AutoLodOptions {
  readonly children: readonly RenderNode[];
  readonly generatedMeshes?: AutoLodGeneratedMeshes;
  readonly quality?: AutoLodQuality;
}

export type RenderNode = AutoLodNode | MeshNode | GltfNode | DirectionalLightNode | TextNode;

export const autoLod = (options: AutoLodOptions): AutoLodNode => ({
  children: options.children,
  generatedMeshes: options.generatedMeshes ?? 'off',
  kind: 'auto-lod',
  quality: options.quality ?? 'balanced'
});
