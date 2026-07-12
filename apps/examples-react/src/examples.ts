import type { ComponentType } from 'react';

export type LoadedExample = {
  readonly Component: ComponentType;
  readonly source: string;
};

export type Example = {
  readonly id: string;
  readonly load: () => Promise<LoadedExample>;
  readonly maturity: 'product' | 'lab-probe';
  readonly navigation?: boolean;
  readonly path: string;
  readonly sourceFile: `examples/cases/${string}.tsx`;
  readonly title: string;
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

export const examples = [
  {
    id: 'cube',
    load: exampleLoader(
      () => import('./examples/cases/HelloCube').then((module) => module.HelloCube),
      () => import('./examples/cases/HelloCube.tsx?raw'),
    ),
    maturity: 'product',
    path: '/cube',
    sourceFile: 'examples/cases/HelloCube.tsx',
    title: 'Cube',
  },
  {
    id: 'wireframe',
    load: exampleLoader(
      () => import('./examples/cases/WireframeCube').then((module) => module.WireframeCube),
      () => import('./examples/cases/WireframeCube.tsx?raw'),
    ),
    maturity: 'product',
    path: '/wireframe',
    sourceFile: 'examples/cases/WireframeCube.tsx',
    title: 'Wireframe',
  },
  {
    id: 'picking',
    load: exampleLoader(
      () => import('./examples/cases/Picking').then((module) => module.Picking),
      () => import('./examples/cases/Picking.tsx?raw'),
    ),
    maturity: 'product',
    path: '/picking',
    sourceFile: 'examples/cases/Picking.tsx',
    title: 'Picking',
  },
  {
    id: 'texture-materials',
    load: exampleLoader(
      () => import('./examples/cases/TextureMaterials').then((module) => module.TextureMaterials),
      () => import('./examples/cases/TextureMaterials.tsx?raw'),
    ),
    maturity: 'product',
    navigation: false,
    path: '/texture-materials',
    sourceFile: 'examples/cases/TextureMaterials.tsx',
    title: 'Texture Materials',
  },
  {
    id: 'virtual-texture-stress',
    load: exampleLoader(
      () => import('./examples/cases/VirtualTextureStress').then((module) => module.VirtualTextureStress),
      () => import('./examples/cases/VirtualTextureStress.tsx?raw'),
    ),
    maturity: 'lab-probe',
    path: '/virtual-texture-stress',
    sourceFile: 'examples/cases/VirtualTextureStress.tsx',
    title: 'Virtual Texture Stress',
  },
  {
    id: 'standard-lighting',
    load: exampleLoader(
      () => import('./examples/cases/StandardLighting').then((module) => module.StandardLighting),
      () => import('./examples/cases/StandardLighting.tsx?raw'),
    ),
    maturity: 'product',
    navigation: true,
    path: '/standard-lighting',
    sourceFile: 'examples/cases/StandardLighting.tsx',
    title: 'Standard Lighting',
  },
  {
    id: 'gltf-helmet',
    load: exampleLoader(
      () => import('./examples/cases/GltfHelmet').then((module) => module.GltfHelmet),
      () => import('./examples/cases/GltfHelmet.tsx?raw'),
    ),
    maturity: 'product',
    path: '/gltf-helmet',
    sourceFile: 'examples/cases/GltfHelmet.tsx',
    title: 'glTF Material Showcase',
  },
  {
    id: 'gltf-instancing',
    load: exampleLoader(
      () => import('./examples/cases/GltfInstancing').then((module) => module.GltfInstancing),
      () => import('./examples/cases/GltfInstancing.tsx?raw'),
    ),
    maturity: 'product',
    path: '/gltf-instancing',
    sourceFile: 'examples/cases/GltfInstancing.tsx',
    title: 'glTF Auto Instancing',
  },
  {
    id: 'gltf-lab',
    load: exampleLoader(
      () => import('./examples/cases/GltfLab').then((module) => module.GltfLab),
      () => import('./examples/cases/GltfLab.tsx?raw'),
    ),
    maturity: 'lab-probe',
    path: '/gltf-lab',
    sourceFile: 'examples/cases/GltfLab.tsx',
    title: 'Khronos Compatibility Lab',
  },
  {
    id: 'gltf-ghostscript-tiger-svg',
    load: exampleLoader(
      () => import('./examples/cases/GltfGhostscriptTigerSvg').then((module) => module.GltfGhostscriptTigerSvg),
      () => import('./examples/cases/GltfGhostscriptTigerSvg.tsx?raw'),
    ),
    maturity: 'product',
    path: '/gltf-ghostscript-tiger-svg',
    sourceFile: 'examples/cases/GltfGhostscriptTigerSvg.tsx',
    title: 'glTF Ghostscript Tiger SVG',
  },
  {
    id: 'gltf-lod',
    load: exampleLoader(
      () => import('./examples/cases/GltfLod').then((module) => module.GltfLod),
      () => import('./examples/cases/GltfLod.tsx?raw'),
    ),
    maturity: 'product',
    path: '/gltf-lod',
    sourceFile: 'examples/cases/GltfLod.tsx',
    title: 'glTF MSFT_lod',
  },
  {
    id: 'gltf-variants',
    load: exampleLoader(
      () => import('./examples/cases/GltfVariants').then((module) => module.GltfVariants),
      () => import('./examples/cases/GltfVariants.tsx?raw'),
    ),
    maturity: 'product',
    path: '/gltf-variants',
    sourceFile: 'examples/cases/GltfVariants.tsx',
    title: 'glTF Material Variants',
  },
  {
    id: 'webxr-vr',
    load: exampleLoader(
      () => import('./examples/cases/WebXrVr').then((module) => module.WebXrVr),
      () => import('./examples/cases/WebXrVr.tsx?raw'),
    ),
    maturity: 'lab-probe',
    path: '/webxr-vr',
    sourceFile: 'examples/cases/WebXrVr.tsx',
    title: 'WebXR VR',
  },
] as const satisfies readonly Example[];

export const firstExample = examples[0];
