/** @jsxImportSource @royal/react */
import { type GltfOptions } from '@royal/renderer-core';
import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { type CSSProperties, type ReactNode } from 'react';

const renderer = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const orbitCanvasStyle = {
  cursor: 'grab',
  touchAction: 'none',
} satisfies CSSProperties;

const orbitOptions = {
  rotateSpeed: 0.006,
  zoomSpeed: 0.0018,
} as const;

const lodSrc = import.meta.env.BASE_URL + 'lod-fixture/msft-lod.gltf';
const largeLodTransform = {
  position: [-2.45, 0, 0],
  rotation: [0.18, -0.28, 0],
  scale: [1.25, 1.25, 1.25],
} as const satisfies NonNullable<GltfOptions['transform']>;
const mediumLodTransform = {
  position: [-0.2, 0, 0],
  rotation: [0.18, -0.28, 0],
  scale: [0.62, 0.62, 0.62],
} as const satisfies NonNullable<GltfOptions['transform']>;
const smallLodTransform = {
  position: [1.42, 0, 0],
  rotation: [0.18, -0.28, 0],
  scale: [0.28, 0.28, 0.28],
} as const satisfies NonNullable<GltfOptions['transform']>;

export const GltfLod = (): ReactNode => {
  const orbit = useOrbitCamera({
    distance: 7.4,
    pitch: 0.02,
  });

  return (
    <Canvas
      aria-label="glTF MSFT_lod"
      renderer={renderer}
      style={orbitCanvasStyle}
    >
      <scene>
        <pass camera={orbit.camera} clearColor={[0.035, 0.042, 0.052, 1]}>
          <directionalLight color={[1.22, 1.16, 1.05, 1]} direction={[-0.42, -0.5, -1]} />
          <model
            src={lodSrc}
            transform={largeLodTransform}
            version="msft-lod-large"
          />
          <model
            src={lodSrc}
            transform={mediumLodTransform}
            version="msft-lod-medium"
          />
          <model
            src={lodSrc}
            transform={smallLodTransform}
            version="msft-lod-small"
          />
        </pass>
      </scene>
      <OrbitControls
        {...orbit.controls}
        {...orbitOptions}
      />
    </Canvas>
  );
};
