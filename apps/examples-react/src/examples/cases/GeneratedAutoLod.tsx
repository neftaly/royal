/** @jsxImportSource @royal/react */
import { type GltfOptions } from '@royal/renderer-core';
import {
  AutoLod,
  Canvas,
  OrbitControls,
  orbitPerspectiveCamera,
  type AutoLodProps,
  type OrbitCameraView,
} from '@royal/react';
import { useState, type CSSProperties, type ReactNode } from 'react';

const renderer = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const orbitCanvasStyle = {
  cursor: 'grab',
  touchAction: 'none',
} satisfies CSSProperties;

const defaultCameraView = {
  distance: 7.8,
  pitch: 0.02,
  target: [0, 0, 0],
  yaw: 0,
} satisfies OrbitCameraView;
const orbitOptions = {
  rotateSpeed: 0.006,
  zoomSpeed: 0.0018,
} as const;

const fixtureSrc = import.meta.env.BASE_URL + 'autolod-fixture/generated-mesh-lod.gltf';
const ExperimentalAutoLod = AutoLod as unknown as (props: AutoLodProps) => ReactNode;
const largeTransform = {
  position: [-2.3, 0, 0],
  rotation: [0.18, -0.34, 0],
  scale: [1.2, 1.2, 1.2],
} as const satisfies NonNullable<GltfOptions['transform']>;
const mediumTransform = {
  position: [-0.05, 0, 0],
  rotation: [0.18, -0.34, 0],
  scale: [0.52, 0.52, 0.52],
} as const satisfies NonNullable<GltfOptions['transform']>;
const smallTransform = {
  position: [1.35, 0, 0],
  rotation: [0.18, -0.34, 0],
  scale: [0.24, 0.24, 0.24],
} as const satisfies NonNullable<GltfOptions['transform']>;

export const GeneratedAutoLod = (): ReactNode => {
  const [cameraView, setCameraView] = useState<OrbitCameraView>(defaultCameraView);
  const camera = orbitPerspectiveCamera({
    far: 100,
    fovY: Math.PI / 4,
    near: 0.1,
    view: cameraView,
  });

  return (
    <Canvas
      aria-label="Experimental generated AutoLod"
      renderer={renderer}
      style={orbitCanvasStyle}
    >
      <scene>
        <pass camera={camera} clearColor={[0.034, 0.042, 0.052, 1]}>
          <directionalLight color={[1.18, 1.12, 1.02, 1]} direction={[-0.44, -0.58, -1]} />
          <ExperimentalAutoLod generatedMeshes="experimental" quality="balanced">
            <gltf
              src={fixtureSrc}
              transform={largeTransform}
              version="generated-autolod-large"
            />
            <gltf
              src={fixtureSrc}
              transform={mediumTransform}
              version="generated-autolod-medium"
            />
            <gltf
              src={fixtureSrc}
              transform={smallTransform}
              version="generated-autolod-small"
            />
          </ExperimentalAutoLod>
        </pass>
      </scene>
      <OrbitControls
        {...orbitOptions}
        defaultView={defaultCameraView}
        onChange={setCameraView}
      />
    </Canvas>
  );
};
