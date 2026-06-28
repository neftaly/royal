import type { ComponentType } from 'react';
import { FakeUiText } from './examples/cases/FakeUiText';
import fakeUiTextSource from './examples/cases/FakeUiText.tsx?raw';
import { HelloCube } from './examples/cases/HelloCube';
import helloCubeSource from './examples/cases/HelloCube.tsx?raw';
import { VirtualTexturingTerrain } from './examples/cases/VirtualTexturingTerrain';
import virtualTexturingTerrainSource from './examples/cases/VirtualTexturingTerrain.tsx?raw';
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
    id: 'fake-ui-text',
    path: '/fake-ui-text',
    title: 'Fake UI + Text/Yoga',
    Component: FakeUiText,
    source: fakeUiTextSource,
    sourceFile: 'examples/cases/FakeUiText.tsx',
  },
  {
    id: 'virtual-texturing-terrain',
    path: '/virtual-texturing',
    title: 'Virtual Texturing Terrain',
    Component: VirtualTexturingTerrain,
    source: virtualTexturingTerrainSource,
    sourceFile: 'examples/cases/VirtualTexturingTerrain.tsx',
  },
] as const satisfies readonly Example[];

export const firstExample = examples[0];
