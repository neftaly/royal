/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  imageTexture,
  type RenderRoot,
  unlitMaterial,
} from '@royal/renderer-core';
import { Canvas } from '@royal/react';
import { createElement, type ReactNode } from 'react';

const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const svgSize = 256;

const badgePath =
  'M 30 48 C 30 33.641 41.641 22 56 22 H 200 C 214.359 22 226 33.641 226 48 V 168 C 226 182.359 214.359 194 200 194 H 94 L 54 230 V 194 H 56 C 41.641 194 30 182.359 30 168 Z';

const badgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgSize} ${svgSize}">
  <rect width="256" height="256" rx="28" fill="#101820"/>
  <path d="${badgePath}" fill="#5ee0c2"/>
  <circle cx="86" cy="94" r="18" fill="#101820" opacity="0.86"/>
  <circle cx="128" cy="94" r="18" fill="#101820" opacity="0.86"/>
  <circle cx="170" cy="94" r="18" fill="#101820" opacity="0.86"/>
  <path d="M76 146 H180" stroke="#101820" stroke-width="16" stroke-linecap="round" opacity="0.72"/>
</svg>`;

const svgToDataUri = (svg: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const badgeMaterial = unlitMaterial({
  baseColor: imageTexture(svgToDataUri(badgeSvg)),
});

const badgePlane = boxGeometry({ size: [2.4, 2.4, 0.04] });

export const SvgGateway = (): ReactNode => {
  const scene = (
    <scene>
      <pass clearColor={[0.04, 0.048, 0.052, 1]}>
        <orthographicCamera
          bottom={-1.45}
          far={100}
          left={-1.45}
          near={0.1}
          position={[0, 0, 10]}
          right={1.45}
          rotation={[0, 0, 0]}
          top={1.45}
        />
        <mesh
          geometry={badgePlane}
          material={badgeMaterial}
          transform={{ position: [0, 0, 0], rotation: [0, 0, 0] }}
        />
      </pass>
    </scene>
  ) as RenderRoot;

  return createElement(Canvas, {
    'aria-label': 'SVG gateway',
    children: scene,
    rootOptions,
  });
};
