import type { ComponentType } from 'react';
import { GltfHelmet } from './examples/cases/GltfHelmet';
import gltfHelmetSource from './examples/cases/GltfHelmet.tsx?raw';
import { HelloCube } from './examples/cases/HelloCube';
import helloCubeSource from './examples/cases/HelloCube.tsx?raw';
import { WireframeCube } from './examples/cases/WireframeCube';
import wireframeCubeSource from './examples/cases/WireframeCube.tsx?raw';

export type Example = {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly Component: ComponentType;
  readonly source: string;
  readonly sourceFile: `examples/cases/${string}.tsx`;
};

export const examples = [
  {
    id: 'cube',
    path: '/cube',
    title: 'Cube',
    Component: HelloCube,
    source: helloCubeSource,
    sourceFile: 'examples/cases/HelloCube.tsx',
  },
  {
    id: 'wireframe',
    path: '/wireframe',
    title: 'Wireframe',
    Component: WireframeCube,
    source: wireframeCubeSource,
    sourceFile: 'examples/cases/WireframeCube.tsx',
  },
  {
    id: 'gltf-helmet',
    path: '/gltf-helmet',
    title: 'glTF Helmet',
    Component: GltfHelmet,
    source: gltfHelmetSource,
    sourceFile: 'examples/cases/GltfHelmet.tsx',
  },
] as const satisfies readonly Example[];

export const firstExample = examples[0];
