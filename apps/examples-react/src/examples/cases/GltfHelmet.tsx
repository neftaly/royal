/** @jsxImportSource @royal/react */
import { type RenderRoot } from '@royal/renderer-core';
import { Canvas } from '@royal/react';
import { createElement, type ReactNode } from 'react';

const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const helmetSrc = import.meta.env.BASE_URL + 'DamagedHelmet/DamagedHelmet.gltf';

export const GltfHelmet = (): ReactNode => {
  const scene = (
    <scene>
      <pass clearColor={[0.04, 0.05, 0.06, 1]}>
        <perspectiveCamera
          far={100}
          fovY={Math.PI / 4}
          near={0.1}
          position={[0, 0.08, 3.4]}
          rotation={[0, 0, 0]}
        />
        <directionalLight color={[1, 0.96, 0.9, 1]} direction={[0.4, -0.75, -1]} />
        <gltf
          src={helmetSrc}
          transform={{
            position: [0, -0.08, 0],
            rotation: [0, 0.34, 0],
            scale: [1.1, 1.1, 1.1],
          }}
        />
      </pass>
    </scene>
  ) as RenderRoot;

  return createElement(Canvas, {
    'aria-label': 'glTF DamagedHelmet',
    children: scene,
    rootOptions,
  });
};
