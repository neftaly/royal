/** @jsxImportSource react */
import {
  Canvas,
  OrbitControls,
  useCanvasRoot,
  useOrbitCamera,
} from '@royal/react';
import { directionalLight, gltf, scene } from '@royal/react/scene';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BenchmarkRendererSnapshot } from '../BenchmarkRendererSnapshot';
import { exampleCanvasContextOptions } from '../example-context-options';
import {
  gltfLabCaseByName,
  gltfLabManifest,
  type GltfLabCase,
} from '../gltf-lab-manifest';
import {
  interactiveCanvasStyle,
  showcaseEnvironment,
  showcaseFillLight,
  showcaseKeyLight,
  showcasePass,
} from '../presentation';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const loadStateFor = (diagnostics: unknown, src: string): string | undefined => {
  if (!isRecord(diagnostics) || !isRecord(diagnostics.gltfLoadDiagnostics)) return undefined;
  const assets = diagnostics.gltfLoadDiagnostics.assets;
  if (!Array.isArray(assets)) return undefined;
  const asset = assets.find((candidate) =>
    isRecord(candidate) && typeof candidate.key === 'string' && candidate.key.includes(src)
  );
  if (!isRecord(asset) || typeof asset.status !== 'string') return undefined;
  return typeof asset.error === 'string' ? `error: ${asset.error}` : asset.status;
};

const GltfLabLoadStatus = ({ src }: { readonly src: string }): ReactNode => {
  const root = useCanvasRoot();
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    if (root === null) return undefined;
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const startedAt = performance.now();
    const inspect = (): void => {
      if (!active) return;
      const next = loadStateFor(root.diagnostics(), src);
      if (next !== undefined) setStatus(next);
      if (next !== 'ready' && !next?.startsWith('error:') && performance.now() - startedAt < 20_000) {
        timeout = setTimeout(inspect, 100);
      }
    };
    inspect();
    return () => {
      active = false;
      if (timeout !== undefined) clearTimeout(timeout);
    };
  }, [root, src]);

  return <output className="gltf-lab-load-status">Renderer: {status}</output>;
};

const selectedCaseName = (): string =>
  new URLSearchParams(globalThis.location?.search ?? '').get('case') ?? 'Box';

const writeSelectedCase = (name: string): void => {
  const url = new URL(globalThis.location.href);
  url.searchParams.set('case', name);
  globalThis.history.pushState(null, '', url);
};

const GltfLabCanvas = ({ entry }: { readonly entry: GltfLabCase }): ReactNode => {
  const orbit = useOrbitCamera({
    initial: { distance: 5.5, pitch: 0.02, target: [0, 0, 0], yaw: 0.12 },
    far: 120,
  });
  const src = import.meta.env.BASE_URL + entry.path;
  const renderScene = useMemo(() => scene({
    camera: orbit.cameraResource,
    environment: showcaseEnvironment,
    ...showcasePass,
    nodes: [
      directionalLight(showcaseKeyLight),
      directionalLight(showcaseFillLight),
      gltf({
        src,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0.2, 0],
          scale: [entry.presentation.scale, entry.presentation.scale, entry.presentation.scale],
        },
      }),
    ],
  }), [entry.presentation.scale, orbit.cameraResource, src]);

  return (
    <Canvas
      aria-label={`Khronos glTF compatibility case ${entry.name}`}
      context={exampleCanvasContextOptions}
      scene={renderScene}
      style={interactiveCanvasStyle}
    >
      <BenchmarkRendererSnapshot />
      <GltfLabLoadStatus src={src} />
      <OrbitControls orbit={orbit} maxDistance={60} minDistance={0.1} />
    </Canvas>
  );
};

export const GltfLab = (): ReactNode => {
  const [name, setName] = useState(selectedCaseName);
  useEffect(() => {
    const syncFromHistory = (): void => setName(selectedCaseName());
    globalThis.addEventListener('popstate', syncFromHistory);
    return () => globalThis.removeEventListener('popstate', syncFromHistory);
  }, []);
  const selectCase = useCallback((nextName: string): void => {
    writeSelectedCase(nextName);
    setName(nextName);
  }, []);
  const entry = gltfLabCaseByName.get(name);

  return (
    <div className="gltf-lab" data-gltf-lab-case={name}>
      <div className="gltf-lab-toolbar">
        <label>
          Khronos case
          <select value={entry?.name ?? ''} onChange={(event) => selectCase(event.currentTarget.value)}>
            {gltfLabManifest.cases.map((candidate) => (
              <option key={candidate.name} value={candidate.name}>
                {candidate.name} — {candidate.status}
              </option>
            ))}
          </select>
        </label>
        {entry === undefined ? (
          <output className="gltf-lab-error">Unknown manifest case: {name}</output>
        ) : (
          <div className="gltf-lab-metadata">
            <span>Status: {entry.status}</span>
            <span>{(entry.bytes / 1024).toFixed(1)} KiB</span>
            <span>{entry.features.length === 0 ? 'core glTF' : entry.features.join(', ')}</span>
          </div>
        )}
      </div>
      {entry?.status === 'supported-oracle' || entry?.status === 'normalized-ingestion'
        ? <GltfLabCanvas entry={entry} />
        : entry === undefined
          ? null
          : (
            <output className="gltf-lab-unsupported">
              Not rendered as a success case: {entry.status}. Required features: {entry.features.join(', ')}.
            </output>
          )}
    </div>
  );
};
