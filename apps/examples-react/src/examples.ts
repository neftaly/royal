import type { ComponentType } from 'react';
import { exampleRoutes, type ExampleContractEntry } from './example-contract';

export type LoadedExample = {
  readonly Component: ComponentType;
  readonly source: string;
};

export type Example = ExampleContractEntry & {
  readonly load: () => Promise<LoadedExample>;
};

type ExampleSourceModule = { readonly default: string };

const exampleLoader = (
  component: () => Promise<ComponentType>,
  source: () => Promise<ExampleSourceModule>,
): (() => Promise<LoadedExample>) => {
  let pending: Promise<LoadedExample> | undefined;
  return () => {
    if (pending !== undefined) return pending;
    const request = Promise.all([component(), source()])
      .then(([Component, sourceModule]) => ({ Component, source: sourceModule.default }));
    pending = request;
    void request.catch(() => {
      if (pending === request) pending = undefined;
    });
    return pending;
  };
};

const exampleLoaders: Record<string, () => Promise<LoadedExample>> = {
  cube: exampleLoader(
    () => import('./examples/cases/HelloCube').then((module) => module.HelloCube),
    () => import('./examples/cases/HelloCube.tsx?raw'),
  ),
  wireframe: exampleLoader(
    () => import('./examples/cases/WireframeCube').then((module) => module.WireframeCube),
    () => import('./examples/cases/WireframeCube.tsx?raw'),
  ),
  picking: exampleLoader(
    () => import('./examples/cases/Picking').then((module) => module.Picking),
    () => import('./examples/cases/Picking.tsx?raw'),
  ),
  'texture-materials': exampleLoader(
    () => import('./examples/cases/TextureMaterials').then((module) => module.TextureMaterials),
    () => import('./examples/cases/TextureMaterials.tsx?raw'),
  ),
  'virtual-texture-stress': exampleLoader(
    () => import('./examples/cases/VirtualTextureStress').then((module) => module.VirtualTextureStress),
    () => import('./examples/cases/VirtualTextureStress.tsx?raw'),
  ),
  'surface-paint-lab': exampleLoader(
    () => import('./examples/cases/SurfacePaintLab').then((module) => module.SurfacePaintLab),
    () => import('./examples/cases/SurfacePaintLab.tsx?raw'),
  ),
  'standard-lighting': exampleLoader(
    () => import('./examples/cases/StandardLighting').then((module) => module.StandardLighting),
    () => import('./examples/cases/StandardLighting.tsx?raw'),
  ),
  'gltf-helmet': exampleLoader(
    () => import('./examples/cases/GltfHelmet').then((module) => module.GltfHelmet),
    () => import('./examples/cases/GltfHelmet.tsx?raw'),
  ),
  'gltf-bistro-web': exampleLoader(
    () => import('./examples/cases/GltfBistroWeb').then((module) => module.GltfBistroWeb),
    () => import('./examples/cases/GltfBistroWeb.tsx?raw'),
  ),
  'gltf-scenes': exampleLoader(
    () => import('./examples/cases/GltfScenes').then((module) => module.GltfScenes),
    () => import('./examples/cases/GltfScenes.tsx?raw'),
  ),
  'gltf-instancing': exampleLoader(
    () => import('./examples/cases/GltfInstancing').then((module) => module.GltfInstancing),
    () => import('./examples/cases/GltfInstancing.tsx?raw'),
  ),
  'gltf-lab': exampleLoader(
    () => import('./examples/cases/GltfLab').then((module) => module.GltfLab),
    () => import('./examples/cases/GltfLab.tsx?raw'),
  ),
  'gltf-ghostscript-tiger-svg': exampleLoader(
    () => import('./examples/cases/GltfGhostscriptTigerSvg').then((module) => module.GltfGhostscriptTigerSvg),
    () => import('./examples/cases/GltfGhostscriptTigerSvg.tsx?raw'),
  ),
  'gltf-lod': exampleLoader(
    () => import('./examples/cases/GltfLod').then((module) => module.GltfLod),
    () => import('./examples/cases/GltfLod.tsx?raw'),
  ),
  'gltf-variants': exampleLoader(
    () => import('./examples/cases/GltfVariants').then((module) => module.GltfVariants),
    () => import('./examples/cases/GltfVariants.tsx?raw'),
  ),
  'webxr-vr': exampleLoader(
    () => import('./examples/cases/WebXrVr').then((module) => module.WebXrVr),
    () => import('./examples/cases/WebXrVr.tsx?raw'),
  ),
};

export const examples: readonly Example[] = exampleRoutes.map((entry) => {
  const load = exampleLoaders[entry.id];
  if (load === undefined) {
    throw new Error(`Example contract entry ${JSON.stringify(entry.id)} has no module loader`);
  }
  return { ...entry, load };
});

const first = examples[0];
if (first === undefined) throw new Error('Example contract must contain at least one route');
export const firstExample = first;
