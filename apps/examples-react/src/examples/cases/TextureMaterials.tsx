/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  solidTexture,
  standardMaterial,
  textureAsset,
  unlitMaterial,
  type RenderRoot,
} from '@royal/renderer-core';
import { Canvas } from '@royal/react';
import { createElement, useEffect, useState, type ReactNode } from 'react';

const swatchGeometry = boxGeometry({ size: [1.18, 1.18, 1.18] });
const fallbackTexture = solidTexture({
  color: [0.12, 0.45, 0.78, 1],
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
const standardSwatch = standardMaterial({
  baseColor: solidTexture({ color: [0.92, 0.32, 0.16, 1] }),
});
const unlitSwatch = unlitMaterial({
  baseColor: solidTexture({ color: [0.2, 0.78, 0.68, 1] }),
});
const texturedSwatch = standardMaterial({
  baseColor: helmetAlbedo,
});
const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const useTextureSettlingFrames = (): number => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    let animationFrame = 0;
    let nextFrame = 0;
    const renderFrame = (): void => {
      nextFrame += 1;
      setFrame(nextFrame);
      if (nextFrame < 24) animationFrame = requestAnimationFrame(renderFrame);
    };

    animationFrame = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  return frame;
};

const materialScene = (frame: number): RenderRoot => {
  const settleSpin = Math.min(frame, 24) * 0.01;

  return (
    <scene>
      <pass clearColor={[0.035, 0.045, 0.052, 1]}>
        <perspectiveCamera
          far={100}
          fovY={Math.PI / 4}
          near={0.1}
          position={[0, 0.18, 6.4]}
          rotation={[0, 0, 0]}
        />
        <directionalLight color={[1, 0.96, 0.88, 1]} direction={[0.45, -0.95, -1]} />
        <mesh
          geometry={swatchGeometry}
          material={standardSwatch}
          transform={{
            position: [-1.72, 0.04, 0],
            rotation: [0.44, 0.7, -0.08],
          }}
        />
        <mesh
          geometry={swatchGeometry}
          material={unlitSwatch}
          transform={{
            position: [0, 0.04, 0],
            rotation: [0.44, 0.7, -0.08],
          }}
        />
        <mesh
          geometry={swatchGeometry}
          material={texturedSwatch}
          transform={{
            position: [1.72, 0.04, 0],
            rotation: [0.44, 0.7 + settleSpin, -0.08],
          }}
        />
      </pass>
    </scene>
  ) as RenderRoot;
};

export const TextureMaterials = (): ReactNode => {
  const frame = useTextureSettlingFrames();

  return createElement(Canvas, {
    'aria-label': 'Texture materials',
    children: materialScene(frame),
    rootOptions,
  });
};
