/** @jsxImportSource react */
import {
  Canvas,
  OrbitControls,
  useGltfAssetStatus,
  useOrbitCamera,
  useRendererLifecycle,
} from '@royal/react';
import { directionalLight, gltf, scene, type GltfAssetRef } from '@royal/react/scene';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BenchmarkRendererSnapshot } from '../BenchmarkRendererSnapshot';
import { exampleCanvasRendererOptions } from '../example-renderer-options';
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

const GltfLabLoadStatus = ({ asset }: { readonly asset: GltfAssetRef }): ReactNode => {
  const status = useGltfAssetStatus(asset);
  const lifecycle = useRendererLifecycle();
  const assetLabel = status.state === 'error' ? `error: ${status.error}` : status.state;
  const rendererLabel = lifecycle.state === 'failed' ? `failed: ${lifecycle.error}` : lifecycle.state;
  return <>
    <BenchmarkRendererSnapshot asset={asset} status={status} />
    <output className="gltf-lab-load-status">
      Renderer: {rendererLabel}; asset: {assetLabel}
    </output>
  </>;
};

const selectedCaseName = (): string =>
  new URLSearchParams(globalThis.location?.search ?? '').get('case') ?? 'Box';

const origin = [0, 0, 0] as const;

const writeSelectedCase = (name: string): void => {
  const url = new URL(globalThis.location.href);
  url.searchParams.set('case', name);
  globalThis.history.pushState(null, '', url);
};

const GltfLabCanvas = ({ entry }: { readonly entry: GltfLabCase }): ReactNode => {
  const orbit = useOrbitCamera({
    initial: { distance: 1.4, pitch: 0, target: [0, 0, 0], yaw: 0 },
    far: 120,
  });
  const src = import.meta.env.BASE_URL + entry.path;
  const position = entry.presentation.position ?? origin;
  const model = useMemo(() => gltf({
    src,
    transform: {
      position,
      rotation: [0, 0, 0],
      scale: [entry.presentation.scale, entry.presentation.scale, entry.presentation.scale],
    },
  }), [entry.presentation.scale, position, src]);
  const renderScene = useMemo(() => scene({
    camera: orbit.camera,
    environment: showcaseEnvironment,
    ...showcasePass,
    nodes: [
      directionalLight(showcaseKeyLight),
      directionalLight(showcaseFillLight),
      model,
    ],
  }), [model, orbit.camera]);

  return (
    <Canvas
      aria-label={`Khronos glTF compatibility case ${entry.name}`}
      rendererOptions={exampleCanvasRendererOptions}
      scene={renderScene}
      style={interactiveCanvasStyle}
    >
      <GltfLabLoadStatus asset={model.asset} />
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
    <div className="gltf-lab">
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
      {entry?.status === 'supported-oracle'
        || entry?.status === 'core-fallback-oracle'
        || entry?.status === 'normalized-ingestion'
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
