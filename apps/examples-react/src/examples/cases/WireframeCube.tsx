/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  wireframeMaterial,
} from '@royal/renderer-core';
import {
  Canvas,
  OrbitControls,
  orbitPerspectiveCamera,
  useFrameIndex,
  type OrbitCameraView,
} from '@royal/react';
import {
  useEffect,
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
  distance: 6,
  pitch: 0.02,
  target: [0, 0, 0],
  yaw: 0,
} satisfies OrbitCameraView;
const orbitOptions = {
  rotateSpeed: 0.006,
  zoomSpeed: 0.0018,
} as const;

const cubeGeometry = boxGeometry({ size: [2.25, 2.25, 2.25] });
const cubeMaterial = wireframeMaterial({
  color: [0.38, 0.85, 0.95, 1],
});

const ScopedFrameIndex = ({
  onFrame,
}: {
  readonly onFrame: (frame: number) => void;
}): null => {
  const frame = useFrameIndex();

  useEffect(() => {
    onFrame(frame);
  }, [frame, onFrame]);

  return null;
};

export const WireframeCube = (): ReactNode => {
  const [cameraView, setCameraView] = useState<OrbitCameraView>(defaultCameraView);
  const [frame, setFrame] = useState(0);
  const camera = orbitPerspectiveCamera({
    far: 100,
    fovY: Math.PI / 4,
    near: 0.1,
    view: cameraView,
  });
  const spin = frame * 0.012;

  return (
    <Canvas
      aria-label="Wireframe cube"
      renderer={renderer}
      style={orbitCanvasStyle}
    >
      <scene>
        <pass camera={camera} clearColor={[0.04, 0.06, 0.08, 1]}>
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
      <OrbitControls
        {...orbitOptions}
        defaultView={defaultCameraView}
        onChange={setCameraView}
      />
      <ScopedFrameIndex onFrame={setFrame} />
    </Canvas>
  );
};
