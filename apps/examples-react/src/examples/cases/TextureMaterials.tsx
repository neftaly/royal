/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  solidTexture,
  standardMaterial,
  textureAsset,
  type RenderRoot,
} from '@royal/renderer-core';
import { Canvas } from '@royal/react';
import { createElement, type ReactNode } from 'react';

const swatchGeometry = boxGeometry({ size: [1.72, 1.72, 1.72] });
const fallbackTexture = solidTexture({
  color: [0.08, 0.1, 0.12, 1],
  id: 'helmet-albedo-fallback',
});
const helmetAlbedo = textureAsset({
  colorSpace: 'srgb',
  fallback: fallbackTexture,
  id: 'helmet-albedo-swatch',
  sampler: {
    magFilter: 'linear',
    minFilter: 'linear-mipmap-linear',
    wrapS: 'clamp-to-edge',
    wrapT: 'clamp-to-edge',
  },
  uri: import.meta.env.BASE_URL + 'DamagedHelmet/Default_albedo.jpg',
});
const texturedSwatch = standardMaterial({
  baseColor: helmetAlbedo,
});
const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const materialScene = (): RenderRoot => (
  <scene>
    <pass clearColor={[0.035, 0.045, 0.052, 1]}>
      <perspectiveCamera
        far={100}
        fovY={Math.PI / 4}
        near={0.1}
        position={[0, 0.16, 5.2]}
        rotation={[0, 0, 0]}
      />
      <directionalLight color={[1.35, 1.28, 1.16, 1]} direction={[-0.24, -0.42, -1]} />
      <mesh
        geometry={swatchGeometry}
        material={texturedSwatch}
        transform={{
          position: [0, 0.02, 0],
          rotation: [0.24, 0.26, -0.04],
        }}
      />
    </pass>
  </scene>
) as RenderRoot;

export const TextureMaterials = (): ReactNode => {
  return createElement(Canvas, {
    'aria-label': 'Texture materials',
    children: materialScene(),
    rootOptions,
  });
};
