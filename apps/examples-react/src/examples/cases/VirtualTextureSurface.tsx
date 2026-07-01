/** @jsxImportSource @royal/react */
import {
  defaultTextureFallbackColor,
  planeGeometry,
  unlitMaterial,
  virtualTexture,
} from '@royal/renderer-core';
import {
  Canvas,
  OrbitControls,
  orbitPerspectiveCamera,
  type OrbitCameraView,
} from '@royal/react';
import {
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

const renderer = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const orbitCanvasStyle = {
  cursor: 'grab',
  touchAction: 'none',
} satisfies CSSProperties;

const defaultCameraView = {
  distance: 4.6,
  pitch: 0.08,
  target: [0, 0, 0],
  yaw: 0,
} satisfies OrbitCameraView;
const orbitOptions = {
  rotateSpeed: 0.006,
  zoomSpeed: 0.0018,
} as const;

const surfaceGeometry = planeGeometry({ size: [3.6, 2.6] });
const virtualTextureMaterial = unlitMaterial({
  texture: virtualTexture({
    colorSpace: 'srgb',
    fallbackColor: defaultTextureFallbackColor,
    sampler: {
      magFilter: 'linear',
      minFilter: 'linear',
      wrapS: 'clamp-to-edge',
      wrapT: 'clamp-to-edge',
    },
    src: import.meta.env.BASE_URL + 'generated-virtual-texture-surface.vt.json',
    version: 'debug-rgba-v1',
  }),
});

export const VirtualTextureSurface = (): ReactNode => {
  const [cameraView, setCameraView] = useState<OrbitCameraView>(defaultCameraView);
  const camera = orbitPerspectiveCamera({
    far: 100,
    fovY: Math.PI / 5,
    near: 0.1,
    view: cameraView,
  });

  return (
    <Canvas
      aria-label="Virtual texture surface"
      renderer={renderer}
      style={orbitCanvasStyle}
    >
      <scene>
        <pass camera={camera} clearColor={[0.035, 0.045, 0.052, 1]}>
          <mesh
            geometry={surfaceGeometry}
            material={virtualTextureMaterial}
            transform={{
              position: [0, 0, 0],
              rotation: [0.62, -0.38, 0],
            }}
          />
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
