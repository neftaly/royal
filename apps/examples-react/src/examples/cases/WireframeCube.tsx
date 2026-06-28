/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  unlitMaterial,
  type RenderNode,
  type RenderRoot,
  type Vec3,
} from '@royal/renderer-core';
import { Canvas } from '@royal/react';
import { createElement, type ReactNode } from 'react';

const barGeometry = boxGeometry({ size: [1, 1, 0.06] });
const edgeMaterial = unlitMaterial({ color: [0.38, 0.85, 0.95, 1] });
const backEdgeMaterial = unlitMaterial({ color: [0.18, 0.42, 0.54, 1] });
const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const bar = (
  start: readonly [number, number],
  end: readonly [number, number],
  material = edgeMaterial,
): RenderNode => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  const position: Vec3 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, 0];

  return (
    <mesh
      geometry={barGeometry}
      material={material}
      transform={{
        position,
        rotation: [0, 0, Math.atan2(dy, dx)],
        scale: [length, 0.055, 1],
      }}
    />
  ) as RenderNode;
};

const wireframeScene = (): RenderRoot => {
  const front = {
    bottomLeft: [-1.35, -1.0] as const,
    bottomRight: [1.15, -1.0] as const,
    topLeft: [-1.35, 1.5] as const,
    topRight: [1.15, 1.5] as const,
  };
  const back = {
    bottomLeft: [-0.45, -1.55] as const,
    bottomRight: [2.05, -1.55] as const,
    topLeft: [-0.45, 0.95] as const,
    topRight: [2.05, 0.95] as const,
  };

  return (
    <scene>
      <pass clearColor={[0.04, 0.06, 0.08, 1]}>
        <orthographicCamera
          bottom={-3}
          far={100}
          left={-4}
          near={0.1}
          position={[0, 0, 8]}
          right={4}
          rotation={[0, 0, 0]}
          top={3}
        />
        {bar(back.bottomLeft, back.bottomRight, backEdgeMaterial)}
        {bar(back.bottomRight, back.topRight, backEdgeMaterial)}
        {bar(back.topRight, back.topLeft, backEdgeMaterial)}
        {bar(back.topLeft, back.bottomLeft, backEdgeMaterial)}
        {bar(front.bottomLeft, front.bottomRight)}
        {bar(front.bottomRight, front.topRight)}
        {bar(front.topRight, front.topLeft)}
        {bar(front.topLeft, front.bottomLeft)}
        {bar(front.bottomLeft, back.bottomLeft)}
        {bar(front.bottomRight, back.bottomRight)}
        {bar(front.topLeft, back.topLeft)}
        {bar(front.topRight, back.topRight)}
      </pass>
    </scene>
  ) as RenderRoot;
};

export const WireframeCube = (): ReactNode =>
  createElement(Canvas, { 'aria-label': 'Wireframe cube', rootOptions }, wireframeScene());
