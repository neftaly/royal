import {
  boxGeometry,
  edgeMaterial,
  linearRgbaFromSrgb,
  mesh,
  scene,
  sceneOverlay,
  screenSpaceSegment,
  type EulerRads,
  type RenderObjectHandle,
  wireframeMaterial,
} from '@royal/react/scene';
import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import {
  useRef,
  useMemo,
  type ReactNode,
} from 'react';
import { BenchmarkRendererSnapshot } from '../BenchmarkRendererSnapshot';
import { exampleCanvasRendererOptions } from '../example-renderer-options';
import { useAnimationFrame } from '../use-animation-frame';

const cubeGeometry = boxGeometry({ size: [2.25, 2.25, 2.25] });
const cubeMaterial = wireframeMaterial({
  color: linearRgbaFromSrgb([0.38, 0.85, 0.95, 1]),
});
const guideMaterial = edgeMaterial({
  color: linearRgbaFromSrgb([0.95, 0.48, 0.12, 0.82]),
  widthCssPixels: 3,
});
const cubeGuides = sceneOverlay({
  nodes: [
    screenSpaceSegment({ end: [1.65, -1.55, 0], material: guideMaterial, start: [-1.65, -1.55, 0] }),
    screenSpaceSegment({ end: [-1.55, 1.65, 0], material: guideMaterial, start: [-1.55, -1.65, 0] }),
  ],
});

const SpinController = ({
  meshRef,
}: {
  readonly meshRef: { current: RenderObjectHandle | null };
}): null => {
  useAnimationFrame((elapsedSeconds) => {
    const handle = meshRef.current;
    if (handle === null) return;

    const spin = elapsedSeconds * 0.72;
    const rotation: EulerRads = [0.42 + spin * 0.28, 0.7 + spin, 0.12];
    handle.setTransform({ rotation });
  });
  return null;
};

export const WireframeCube = (): ReactNode => {
  const meshRef = useRef<RenderObjectHandle | null>(null);
  const orbit = useOrbitCamera({
    initial: { distance: 6, pitch: 0.02 },
  });
  const renderScene = useMemo(() => scene({
    camera: orbit.camera,
    toneMapping: 'linear-clamp',
    nodes: [mesh({
      ref: meshRef,
      geometry: cubeGeometry,
      material: cubeMaterial,
      transform: { position: [0, 0, 0], rotation: [0.42, 0.7, 0.12] },
    })],
  }), [orbit.camera]);

  return (
    <Canvas
      aria-label="Wireframe cube"
      overlay={cubeGuides}
      rendererOptions={exampleCanvasRendererOptions}
      scene={renderScene}
    >
      <BenchmarkRendererSnapshot />
      <SpinController meshRef={meshRef} />
      <OrbitControls orbit={orbit} />
    </Canvas>
  );
};
