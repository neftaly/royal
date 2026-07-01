import type { ComponentType } from 'react';
import { DonnybrookAwarenessPhysics } from './examples/cases/donnybrook/DonnybrookAwarenessPhysics';
import donnybrookAwarenessPhysicsSource from './examples/cases/donnybrook/DonnybrookAwarenessPhysics.tsx?raw';
import { FormControls } from './examples/cases/FormControls';
import formControlsSource from './examples/cases/FormControls.tsx?raw';
import { GltfHelmet } from './examples/cases/GltfHelmet';
import gltfHelmetSource from './examples/cases/GltfHelmet.tsx?raw';
import { GltfLod } from './examples/cases/GltfLod';
import gltfLodSource from './examples/cases/GltfLod.tsx?raw';
import { GeneratedAutoLod } from './examples/cases/GeneratedAutoLod';
import generatedAutoLodSource from './examples/cases/GeneratedAutoLod.tsx?raw';
import { HelloCube } from './examples/cases/HelloCube';
import helloCubeSource from './examples/cases/HelloCube.tsx?raw';
import { Picking } from './examples/cases/Picking';
import pickingSource from './examples/cases/Picking.tsx?raw';
import { RendererText } from './examples/cases/RendererText';
import rendererTextSource from './examples/cases/RendererText.tsx?raw';
import { StandardLighting } from './examples/cases/StandardLighting';
import standardLightingSource from './examples/cases/StandardLighting.tsx?raw';
import { TextureMaterials } from './examples/cases/TextureMaterials';
import textureMaterialsSource from './examples/cases/TextureMaterials.tsx?raw';
import { WireframeCube } from './examples/cases/WireframeCube';
import wireframeCubeSource from './examples/cases/WireframeCube.tsx?raw';

export type Example = {
  readonly id: string;
  readonly maturity: 'product' | 'lab-probe';
  readonly path: string;
  readonly title: string;
  readonly Component: ComponentType;
  readonly source: string;
  readonly sourceFile: `examples/cases/${string}.tsx`;
};

export const examples = [
  {
    id: 'cube',
    maturity: 'product',
    path: '/cube',
    title: 'Cube',
    Component: HelloCube,
    source: helloCubeSource,
    sourceFile: 'examples/cases/HelloCube.tsx',
  },
  {
    id: 'wireframe',
    maturity: 'product',
    path: '/wireframe',
    title: 'Wireframe',
    Component: WireframeCube,
    source: wireframeCubeSource,
    sourceFile: 'examples/cases/WireframeCube.tsx',
  },
  {
    id: 'text',
    maturity: 'product',
    path: '/text',
    title: 'Text',
    Component: RendererText,
    source: rendererTextSource,
    sourceFile: 'examples/cases/RendererText.tsx',
  },
  {
    id: 'form-controls',
    maturity: 'product',
    path: '/form-controls',
    title: 'Form Controls',
    Component: FormControls,
    source: formControlsSource,
    sourceFile: 'examples/cases/FormControls.tsx',
  },
  {
    id: 'picking',
    maturity: 'product',
    path: '/picking',
    title: 'Picking',
    Component: Picking,
    source: pickingSource,
    sourceFile: 'examples/cases/Picking.tsx',
  },
  {
    id: 'texture-materials',
    maturity: 'product',
    path: '/texture-materials',
    title: 'Texture Materials',
    Component: TextureMaterials,
    source: textureMaterialsSource,
    sourceFile: 'examples/cases/TextureMaterials.tsx',
  },
  {
    id: 'standard-lighting',
    maturity: 'product',
    path: '/standard-lighting',
    title: 'Standard Lighting',
    Component: StandardLighting,
    source: standardLightingSource,
    sourceFile: 'examples/cases/StandardLighting.tsx',
  },
  {
    id: 'gltf-helmet',
    maturity: 'product',
    path: '/gltf-helmet',
    title: 'glTF Subset Helmet',
    Component: GltfHelmet,
    source: gltfHelmetSource,
    sourceFile: 'examples/cases/GltfHelmet.tsx',
  },
  {
    id: 'gltf-lod',
    maturity: 'product',
    path: '/gltf-lod',
    title: 'glTF MSFT_lod',
    Component: GltfLod,
    source: gltfLodSource,
    sourceFile: 'examples/cases/GltfLod.tsx',
  },
  {
    id: 'generated-autolod',
    maturity: 'lab-probe',
    path: '/generated-autolod',
    title: 'Experimental AutoLod',
    Component: GeneratedAutoLod,
    source: generatedAutoLodSource,
    sourceFile: 'examples/cases/GeneratedAutoLod.tsx',
  },
  {
    id: 'donnybrook-awareness-physics',
    maturity: 'lab-probe',
    path: '/donnybrook-awareness-physics',
    title: 'Donnybrook Awareness Physics',
    Component: DonnybrookAwarenessPhysics,
    source: donnybrookAwarenessPhysicsSource,
    sourceFile: 'examples/cases/donnybrook/DonnybrookAwarenessPhysics.tsx',
  },
] as const satisfies readonly Example[];

export const firstExample = examples[0];
