/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  imageTexture,
  type RenderRoot,
} from '@royal/renderer-core';
import { Canvas } from '@royal/react';
import { createElement, type ReactNode } from 'react';

const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const swatchGeometry = boxGeometry({ size: [1.72, 1.72, 1.72] });
const helmetAlbedo = imageTexture(import.meta.env.BASE_URL + 'DamagedHelmet/Default_albedo.jpg');

export const TextureMaterials = (): ReactNode => {
  const scene = (
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
          texture={helmetAlbedo}
          transform={{
            position: [0, 0.02, 0],
            rotation: [0.24, 0.26, -0.04],
          }}
        />
      </pass>
    </scene>
  ) as RenderRoot;

  return createElement(Canvas, {
    'aria-label': 'Texture materials',
    children: scene,
    rootOptions,
  });
};
