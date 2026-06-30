/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  type RenderRoot,
  wireframeMaterial,
} from '@royal/renderer-core';
import { Canvas, useFrame } from '@royal/react';
import { createElement, type ReactNode } from 'react';

const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const cubeGeometry = boxGeometry({ size: [2.25, 2.25, 2.25] });
const cubeMaterial = wireframeMaterial({
  color: [0.38, 0.85, 0.95, 1],
});

export const WireframeCube = (): ReactNode => {
  const frame = useFrame();
  const spin = frame * 0.012;
  const scene = (
    <scene>
      <pass clearColor={[0.04, 0.06, 0.08, 1]}>
        <perspectiveCamera
          far={100}
          fovY={Math.PI / 4}
          near={0.1}
          position={[0, 0.08, 6]}
          rotation={[0, 0, 0]}
        />
        <mesh
          geometry={cubeGeometry}
          material={cubeMaterial}
          transform={{
            position: [0, 0, 0],
            rotation: [0.42 + spin * 0.28, 0.7 + spin, 0.12],
          }}
        />
      </pass>
    </scene>
  ) as RenderRoot;

  return createElement(Canvas, {
    'aria-label': 'Wireframe cube',
    children: scene,
    rootOptions,
  });
};
