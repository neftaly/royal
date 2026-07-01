/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  planeGeometry,
  standardMaterial,
  unlitMaterial,
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
  distance: 7.2,
  pitch: -0.03,
  target: [0, 0.08, 0],
  yaw: 0,
} satisfies OrbitCameraView;
const orbitOptions = {
  rotateSpeed: 0.006,
  zoomSpeed: 0.0018,
} as const;

const backdropGeometry = planeGeometry([6.4, 3.4]);
const comparisonPanelGeometry = planeGeometry([1.28, 1.85]);
const cubeGeometry = boxGeometry([0.82, 0.82, 0.82]);
const tallBlockGeometry = boxGeometry([0.56, 1.28, 0.56]);
const slabGeometry = boxGeometry([1.12, 0.36, 1.12]);
const lightMarkerGeometry = planeGeometry([0.34, 0.34]);
const lightShaftGeometry = boxGeometry([0.08, 0.08, 1.36]);
const backdropMaterial = standardMaterial({ color: [0.12, 0.17, 0.2, 1] });
const slateMaterial = standardMaterial({ color: [0.24, 0.32, 0.36, 1] });
const tealMaterial = standardMaterial({ color: [0.08, 0.74, 0.67, 1] });
const coralMaterial = standardMaterial({ color: [0.94, 0.34, 0.22, 1] });
const violetMaterial = standardMaterial({ color: [0.52, 0.42, 0.88, 1] });
const unlitMarkerMaterial = unlitMaterial({ color: [0.98, 0.9, 0.32, 1] });

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

export const StandardLighting = (): ReactNode => {
  const [cameraView, setCameraView] = useState<OrbitCameraView>(defaultCameraView);
  const [frame, setFrame] = useState(0);
  const camera = orbitPerspectiveCamera({
    far: 100,
    fovY: Math.PI / 4,
    near: 0.1,
    view: cameraView,
  });
  const sweep = frame * 0.021;
  const lightDirection = [
    Math.cos(sweep) * 0.72,
    -0.82,
    -0.58 + Math.sin(sweep) * 0.66,
  ] satisfies readonly [number, number, number];
  const lightMarkerPosition = [
    -lightDirection[0] * 2.35,
    1.18,
    -lightDirection[2] * 0.95 + 0.08,
  ] satisfies readonly [number, number, number];

  return (
    <Canvas
      aria-label="Standard material animated directional lighting"
      renderer={renderer}
      style={orbitCanvasStyle}
    >
      <scene>
        <pass camera={camera} clearColor={[0.035, 0.043, 0.05, 1]}>
          <directionalLight color={[1.32, 1.22, 1.04, 1]} direction={lightDirection} />
          <mesh
            geometry={backdropGeometry}
            material={backdropMaterial}
            transform={{
              position: [0, 0, -0.72],
              rotation: [0, 0, 0],
            }}
          />
          <mesh
            geometry={comparisonPanelGeometry}
            material={slateMaterial}
            transform={{
              position: [-2.05, -0.16, -0.18],
              rotation: [0, -0.68, 0],
            }}
          />
          <mesh
            geometry={comparisonPanelGeometry}
            material={slateMaterial}
            transform={{
              position: [0, -0.18, -0.42],
              rotation: [0, 0, 0],
            }}
          />
          <mesh
            geometry={comparisonPanelGeometry}
            material={slateMaterial}
            transform={{
              position: [2.05, -0.16, -0.18],
              rotation: [0, 0.68, 0],
            }}
          />
          <mesh
            geometry={cubeGeometry}
            material={tealMaterial}
            transform={{
              position: [-1.95, 0.28, 0.26],
              rotation: [0.45, 0.64, 0.08],
            }}
          />
          <mesh
            geometry={slabGeometry}
            material={coralMaterial}
            transform={{
              position: [0, 0.1, 0.2],
              rotation: [-0.16, -0.46, 0.14],
            }}
          />
          <mesh
            geometry={tallBlockGeometry}
            material={violetMaterial}
            transform={{
              position: [1.95, 0.34, 0.22],
              rotation: [0.2, -0.56, -0.1],
            }}
          />
          <mesh
            geometry={lightShaftGeometry}
            material={unlitMarkerMaterial}
            transform={{
              position: [
                lightMarkerPosition[0] * 0.72,
                lightMarkerPosition[1] - 0.12,
                lightMarkerPosition[2] * 0.72,
              ],
              rotation: [0.52, sweep, 0],
            }}
          />
          <mesh
            geometry={lightMarkerGeometry}
            material={unlitMarkerMaterial}
            transform={{
              position: lightMarkerPosition,
              rotation: [0, 0, sweep + 0.78],
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
