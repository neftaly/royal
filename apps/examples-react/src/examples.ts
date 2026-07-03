import type { ComponentType } from 'react';
import { FormControls } from './examples/cases/FormControls';
import formControlsSource from './examples/cases/FormControls.tsx?raw';
import { GltfHelmet } from './examples/cases/GltfHelmet';
import gltfHelmetSource from './examples/cases/GltfHelmet.tsx?raw';
import { GltfInstancing } from './examples/cases/GltfInstancing';
import gltfInstancingSource from './examples/cases/GltfInstancing.tsx?raw';
import { GltfLod } from './examples/cases/GltfLod';
import gltfLodSource from './examples/cases/GltfLod.tsx?raw';
import { GltfMaterialExtensions } from './examples/cases/GltfMaterialExtensions';
import gltfMaterialExtensionsSource from './examples/cases/GltfMaterialExtensions.tsx?raw';
import { GltfGhostscriptTigerSvg } from './examples/cases/GltfGhostscriptTigerSvg';
import gltfGhostscriptTigerSvgSource from './examples/cases/GltfGhostscriptTigerSvg.tsx?raw';
import { GltfVariants } from './examples/cases/GltfVariants';
import gltfVariantsSource from './examples/cases/GltfVariants.tsx?raw';
import { HelloCube } from './examples/cases/HelloCube';
import helloCubeSource from './examples/cases/HelloCube.tsx?raw';
import { HudOverlay } from './examples/cases/HudOverlay';
import hudOverlaySource from './examples/cases/HudOverlay.tsx?raw';
import { Picking } from './examples/cases/Picking';
import pickingSource from './examples/cases/Picking.tsx?raw';
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
    id: 'hud-overlay',
    maturity: 'product',
    path: '/hud-overlay',
    title: 'HUD Overlay',
    Component: HudOverlay,
    source: hudOverlaySource,
    sourceFile: 'examples/cases/HudOverlay.tsx',
  },
  {
    id: 'gltf-helmet',
    maturity: 'product',
    path: '/gltf-helmet',
    title: 'glTF PBR Helmet',
    Component: GltfHelmet,
    source: gltfHelmetSource,
    sourceFile: 'examples/cases/GltfHelmet.tsx',
  },
  {
    id: 'gltf-instancing',
    maturity: 'product',
    path: '/gltf-instancing',
    title: 'glTF Auto Instancing',
    Component: GltfInstancing,
    source: gltfInstancingSource,
    sourceFile: 'examples/cases/GltfInstancing.tsx',
  },
  {
    id: 'gltf-material-extensions',
    maturity: 'product',
    path: '/gltf-material-extensions',
    title: 'glTF Material Extensions',
    Component: GltfMaterialExtensions,
    source: gltfMaterialExtensionsSource,
    sourceFile: 'examples/cases/GltfMaterialExtensions.tsx',
  },
  {
    id: 'gltf-ghostscript-tiger-svg',
    maturity: 'product',
    path: '/gltf-ghostscript-tiger-svg',
    title: 'glTF Ghostscript Tiger SVG',
    Component: GltfGhostscriptTigerSvg,
    source: gltfGhostscriptTigerSvgSource,
    sourceFile: 'examples/cases/GltfGhostscriptTigerSvg.tsx',
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
    id: 'gltf-variants',
    maturity: 'product',
    path: '/gltf-variants',
    title: 'glTF Material Variants',
    Component: GltfVariants,
    source: gltfVariantsSource,
    sourceFile: 'examples/cases/GltfVariants.tsx',
  },
] as const satisfies readonly Example[];

export const firstExample = examples[0];
