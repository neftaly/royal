import { Canvas, OrbitControls, useCanvasRoot, useOrbitCamera } from '@royal/react';
import { scene } from '@royal/react/scene';
import { useLayoutEffect, useState, type ReactNode } from 'react';
import { BenchmarkRendererSnapshot } from '../BenchmarkRendererSnapshot';
import { exampleCanvasRendererOptions } from '../example-renderer-options';
import { automaticVirtualTextureExampleRendererOptions } from '../example-renderer-options';
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

const retainExactPicking = (): void => undefined;

const readOptions = (): SurfacePaintWorkloadOptions => {
  const params = new URL(globalThis.location.href).searchParams;
  const requestedBrush = params.get('paintBrush');
  const requestedKind = params.get('paintKind');
  const requestedOwnership = params.get('paintOwnership');
  const requestedPresentation = params.get('paintPresentation');
  const pieces = integerParam(params, 'paintPieces', 96, 1);
  return {
    brush: requestedBrush === 'marker' || requestedBrush === 'solid' || requestedBrush === 'stamp'
      ? requestedBrush
      : 'mixed',
    colors: integerParam(params, 'paintColors', 4, 1),
    kind: requestedKind === 'cards' || requestedKind === 'minis' ? requestedKind : 'mixed',
    ownership: requestedOwnership === 'world' ? 'world' : 'piece',
    pickTriangles: integerParam(params, 'paintPickTriangles', 0, 0),
    presentation: requestedPresentation === 'svg-vt' ? 'svg-vt' : 'geometry',
    pieces,
    pointsPerStroke: integerParam(params, 'paintPoints', 20, 2),
    strokesPerPiece: integerParam(params, 'paintStrokes', 12, 1),
    surfaceLift: finiteParam(params, 'paintLiftMicrometres', 500) / 1_000_000,
    textureVariants: integerParam(params, 'paintTextures', pieces, 1),
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
      data-paint-brush={options.brush}
      data-paint-colors={options.colors}
      data-paint-kind={options.kind}
      data-paint-live={live}
      data-paint-ownership={options.ownership}
      data-paint-pieces={workload.pieces}
      data-paint-pick-triangles={options.pickTriangles}
      data-paint-presentation={options.presentation}
      data-paint-surface-lift={options.surfaceLift}
      data-paint-textures={options.textureVariants}
      data-paint-triangles={workload.paintTriangles}
      data-paint-vertices={workload.paintVertices}
      rendererOptions={options.presentation === 'svg-vt'
        ? automaticVirtualTextureExampleRendererOptions
        : exampleCanvasRendererOptions}
      scene={renderScene}
      style={interactiveCanvasStyle}
      {...(options.pickTriangles > 0 ? { onPointerMove: retainExactPicking } : {})}
    >
      <BenchmarkRendererSnapshot />
      {options.pickTriangles > 0 ? <PickLatencyProbe /> : null}
      {live ? (
        <LivePaintTicker
          advance={() => setLivePoints((points) => (points === 128 ? 2 : points + 1))}
        />
      ) : null}
      <OrbitControls enablePan orbit={orbit} />
    </Canvas>
  );
};

declare global {
  // eslint-disable-next-line no-var
  var __royalSurfacePaintPickProbe: Readonly<Record<string, number>> | undefined;
}

const percentile = (sorted: readonly number[], ratio: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))] ?? 0;

const PickLatencyProbe = (): null => {
  const root = useCanvasRoot();
  useLayoutEffect(() => {
    if (root === null) return undefined;
    globalThis.__royalSurfacePaintPickProbe = undefined;
    const timeout = globalThis.setTimeout(() => {
      const canvas = document.querySelector('canvas');
      const bounds = canvas?.getBoundingClientRect();
      if (bounds === undefined) return;
      let input: Readonly<{ clientX: number; clientY: number }> | undefined;
      for (let row = 1; row < 20 && input === undefined; row += 1) {
        for (let column = 1; column < 20; column += 1) {
          const candidate = {
            clientX: bounds.left + bounds.width * column / 20,
            clientY: bounds.top + bounds.height * row / 20,
          };
          if (root.pick(candidate) !== undefined) {
            input = candidate;
            break;
          }
        }
      }
      if (input === undefined) return;
      let hits = 0;
      const batchStarted = performance.now();
      const durations = Array.from({ length: 120 }, () => {
        const started = performance.now();
        const hit = root.pick(input);
        if (hit !== undefined) hits += 1;
        return performance.now() - started;
      }).sort((left, right) => left - right);
      const totalMs = performance.now() - batchStarted;
      globalThis.__royalSurfacePaintPickProbe = {
        averageMs: totalMs / durations.length,
        hits,
        maximumMs: durations.at(-1) ?? 0,
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
        samples: durations.length,
        totalMs,
      };
    }, 500);
    return () => {
      globalThis.clearTimeout(timeout);
      globalThis.__royalSurfacePaintPickProbe = undefined;
    };
  }, [root]);
  return null;
};

const LivePaintTicker = ({ advance }: { readonly advance: () => void }): null => {
  useAnimationFrame(advance);
  return null;
};
