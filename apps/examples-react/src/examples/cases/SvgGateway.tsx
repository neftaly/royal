/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  solidTexture,
  textureAsset,
  type RenderRoot,
  unlitMaterial,
} from '@royal/renderer-core';
import {
  createSvgGatewayGeometry,
  createSvgRasterTextureSource,
} from '@royal/renderer-core/svg';
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

const badgeGeometry = createSvgGatewayGeometry({
  d: badgePath,
  id: 'speech-badge-path',
  kind: 'path',
});

const badgeRaster = createSvgRasterTextureSource({
  height: svgSize,
  id: 'speech-badge-raster',
  svg: badgeSvg,
  width: svgSize,
});

const fallbackTexture = solidTexture({
  color: [0.08, 0.1, 0.12, 1],
});

const badgeMaterial = unlitMaterial({
  baseColor: textureAsset({
    colorSpace: 'srgb',
    fallback: fallbackTexture,
    sampler: {
      magFilter: 'linear',
      minFilter: 'linear',
      wrapS: 'clamp-to-edge',
      wrapT: 'clamp-to-edge',
    },
    src: svgToDataUri(badgeSvg),
  }),
});

const backdropMaterial = unlitMaterial({
  baseColor: solidTexture({ color: [0.12, 0.16, 0.18, 1] }),
});

const panelGeometry = boxGeometry({ size: [2.6, 2.6, 0.04] });
const backdropGeometry = boxGeometry({ size: [2.9, 2.9, 0.04] });

export const SvgGateway = (): ReactNode => {
  const scene = (
    <scene>
      <pass clearColor={[0.04, 0.048, 0.052, 1]}>
        <orthographicCamera
          bottom={-1.75}
          far={100}
          left={-3.3}
          near={0.1}
          position={[0, 0, 10]}
          right={3.3}
          rotation={[0, 0, 0]}
          top={1.75}
        />
        <mesh
          geometry={backdropGeometry}
          material={backdropMaterial}
          transform={{ position: [-1.2, 0, -0.05], rotation: [0, 0, 0] }}
        />
        <mesh
          geometry={panelGeometry}
          material={badgeMaterial}
          transform={{ position: [-1.2, 0, 0], rotation: [0, 0, 0] }}
        />
        <text
          color={[0.93, 0.97, 0.96, 1]}
          fontSize={0.22}
          lineHeight={0.264}
          origin={[0.65, 0.95, 0.1]}
          text="SVG gateway"
        />
        <text
          color={[0.67, 0.75, 0.76, 1]}
          fontSize={0.12}
          lineHeight={0.154}
          origin={[0.65, 0.55, 0.1]}
          text="createSvgGatewayGeometry"
        />
        <text
          color={[0.67, 0.75, 0.76, 1]}
          fontSize={0.12}
          lineHeight={0.154}
          origin={[0.65, 0.31, 0.1]}
          text="createSvgRasterTextureSource"
        />
        <text
          color={[0.67, 0.75, 0.76, 1]}
          fontSize={0.12}
          lineHeight={0.154}
          origin={[0.65, 0.07, 0.1]}
          text="textureAsset"
        />
        <text
          color={[0.86, 0.91, 0.88, 1]}
          fontSize={0.11}
          lineHeight={0.132}
          origin={[0.65, -0.42, 0.1]}
          text={`path mesh: ${badgeGeometry.mesh.indices.length / 3} triangles`}
        />
        <text
          color={[0.58, 0.66, 0.67, 1]}
          fontSize={0.095}
          lineHeight={0.114}
          origin={[0.65, -0.66, 0.1]}
          text={`raster: ${badgeRaster.width} x ${badgeRaster.height}`}
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
