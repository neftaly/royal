import type { ComponentType } from 'react';
import { GltfHelmet } from './examples/cases/GltfHelmet';
import gltfHelmetSource from './examples/cases/GltfHelmet.tsx?raw';
import { HelloCube } from './examples/cases/HelloCube';
import helloCubeSource from './examples/cases/HelloCube.tsx?raw';
import { RendererText } from './examples/cases/RendererText';
import rendererTextSource from './examples/cases/RendererText.tsx?raw';
import { TextureMaterials } from './examples/cases/TextureMaterials';
import textureMaterialsSource from './examples/cases/TextureMaterials.tsx?raw';
import { VirtualTexturingPlane } from './examples/cases/VirtualTexturingPlane';
import virtualTexturingPlaneSource from './examples/cases/VirtualTexturingPlane.tsx?raw';
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
    id: 'texture-materials',
    maturity: 'product',
    path: '/texture-materials',
    title: 'Texture Materials',
    Component: TextureMaterials,
    source: textureMaterialsSource,
    sourceFile: 'examples/cases/TextureMaterials.tsx',
  },
  {
    id: 'virtual-texturing',
    maturity: 'product',
    path: '/virtual-texturing',
    title: 'Virtual Texturing',
    Component: VirtualTexturingPlane,
    source: virtualTexturingPlaneSource,
    sourceFile: 'examples/cases/VirtualTexturingPlane.tsx',
  },
  {
    id: 'gltf-helmet',
    maturity: 'product',
    path: '/gltf-helmet',
    title: 'glTF Helmet',
    Component: GltfHelmet,
    source: gltfHelmetSource,
    sourceFile: 'examples/cases/GltfHelmet.tsx',
  },
] as const satisfies readonly Example[];

export const firstExample = examples[0];
