import { Canvas, OrbitControls, useOrbitCamera } from '@royal/react';
import { scene } from '@royal/react/scene';
import { useState, type ReactNode } from 'react';
import { BenchmarkRendererSnapshot } from '../BenchmarkRendererSnapshot';
import { exampleCanvasRendererOptions } from '../example-renderer-options';
import { colorAccuratePass, interactiveCanvasStyle } from '../presentation';
import {
  createLiveSurfacePaintNode,
  createSurfacePaintWorkload,
  type SurfacePaintWorkloadOptions,
} from '../surface-paint-workload';
import { useAnimationFrame } from '../use-animation-frame';

const integerParam = (
  params: URLSearchParams,
  name: string,
  fallback: number,
  minimum: number,
): number => {
  const value = Number.parseInt(params.get(name) ?? '', 10);
  return Number.isSafeInteger(value) && value >= minimum ? value : fallback;
};

const finiteParam = (
  params: URLSearchParams,
  name: string,
  fallback: number,
): number => {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const readOptions = (): SurfacePaintWorkloadOptions => {
  const params = new URL(globalThis.location.href).searchParams;
  const requestedKind = params.get('paintKind');
  const requestedOwnership = params.get('paintOwnership');
  return {
    kind: requestedKind === 'cards' || requestedKind === 'minis' ? requestedKind : 'mixed',
    ownership: requestedOwnership === 'world' ? 'world' : 'piece',
    pieces: integerParam(params, 'paintPieces', 96, 1),
    pointsPerStroke: integerParam(params, 'paintPoints', 20, 2),
    strokesPerPiece: integerParam(params, 'paintStrokes', 12, 1),
    surfaceLift: finiteParam(params, 'paintLiftMicrometres', 500) / 1_000_000,
  };
};

export const SurfacePaintLab = (): ReactNode => {
  const live = new URL(globalThis.location.href).searchParams.get('paintLive') === '1';
  const [options] = useState(readOptions);
  const [workload] = useState(() => createSurfacePaintWorkload(options));
  const [livePoints, setLivePoints] = useState(2);
  const distance = 1.35 * Math.sqrt(options.pieces / 96);
  const orbit = useOrbitCamera({
    far: 20,
    initial: { distance, pitch: 0.15, target: [0, 0, 0] },
    near: 0.001,
  });
  const renderScene = scene({
    camera: orbit.camera,
    ...colorAccuratePass,
    nodes: live
      ? [
          ...workload.nodes,
          createLiveSurfacePaintNode(livePoints, workload.pieces, options.surfaceLift),
        ]
      : workload.nodes,
  });

  return (
    <Canvas
      aria-label="Surface paint scaling lab"
      data-paint-ink-meshes={workload.inkMeshes}
      data-paint-kind={options.kind}
      data-paint-live={live}
      data-paint-ownership={options.ownership}
      data-paint-pieces={workload.pieces}
      data-paint-surface-lift={options.surfaceLift}
      data-paint-triangles={workload.paintTriangles}
      data-paint-vertices={workload.paintVertices}
      rendererOptions={exampleCanvasRendererOptions}
      scene={renderScene}
      style={interactiveCanvasStyle}
    >
      <BenchmarkRendererSnapshot />
      {live ? (
        <LivePaintTicker
          advance={() => setLivePoints((points) => (points === 128 ? 2 : points + 1))}
        />
      ) : null}
      <OrbitControls enablePan orbit={orbit} />
    </Canvas>
  );
};

const LivePaintTicker = ({ advance }: { readonly advance: () => void }): null => {
  useAnimationFrame(advance);
  return null;
};
