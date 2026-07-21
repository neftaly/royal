/** @jsxImportSource react */
import {
  Canvas,
  GltfOrbitCameraFit,
  OrbitControls,
  useGltfAssetStatus,
  useOrbitCamera,
} from "@royal/react";
import { directionalLight, gltf, scene, type GltfAssetRef } from "@royal/react/scene";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { BenchmarkRendererSnapshot } from "../BenchmarkRendererSnapshot";
import { exampleCanvasRendererOptions } from "../example-renderer-options";
import {
  interactiveCanvasStyle,
  materialEnvironment,
  materialFillLight,
  materialKeyLight,
  materialPass,
} from "../presentation";

const bistroScenes = [
  { id: "exterior", sceneIndex: 0, title: "Exterior" },
  { id: "interior", sceneIndex: 1, title: "Interior" },
  { id: "interior-wine", sceneIndex: 2, title: "Interior Wine" },
] as const;
type BistroSceneId = typeof bistroScenes[number]["id"];
const defaultBistroScene = bistroScenes[2];
const bistroSceneById: ReadonlyMap<string, typeof bistroScenes[number]> = new Map(
  bistroScenes.map((entry) => [entry.id, entry]),
);

const bistroSceneIdFromLocation = (): BistroSceneId => {
  const candidate = new URLSearchParams(globalThis.location?.search ?? "").get("scene");
  return bistroSceneById.has(candidate ?? "")
    ? candidate as BistroSceneId
    : defaultBistroScene.id;
};

const writeBistroSceneId = (id: BistroSceneId): void => {
  const url = new URL(globalThis.location.href);
  url.searchParams.set("scene", id);
  globalThis.history.pushState(null, "", url);
};

const BistroStatus = ({ asset }: Readonly<{ asset: GltfAssetRef }>): ReactNode => {
  const status = useGltfAssetStatus(asset);
  let value: string = status.status;
  if (
    status.status === "ready"
    || status.status === "streaming"
    || status.status === "degraded"
  ) {
    const failed = status.textures.failed === 0
      ? ""
      : ` · ${status.textures.failed} failed`;
    value = `${status.status} · ${status.primitiveCount} primitives · ${status.textures.ready}/${status.textures.total} textures${failed}`;
  } else if (status.status === "error") value = `error · ${status.error}`;
  return (
    <>
      <BenchmarkRendererSnapshot asset={asset} status={status} />
      <output className="status" data-gltf-status={status.status}>{value}</output>
    </>
  );
};

export const GltfBistroWeb = (): ReactNode => {
  const [sceneId, setSceneId] = useState(bistroSceneIdFromLocation);
  const selectedScene = bistroSceneById.get(sceneId) ?? defaultBistroScene;
  const orbit = useOrbitCamera({
    far: 250,
    initial: {
      distance: 50,
      pitch: 0.35,
      target: [8.5, 5.625, -6.125],
      yaw: Math.PI / 4,
    },
    near: 0.025,
  });
  useEffect(() => {
    const syncFromHistory = (): void => setSceneId(bistroSceneIdFromLocation());
    globalThis.addEventListener("popstate", syncFromHistory);
    return () => globalThis.removeEventListener("popstate", syncFromHistory);
  }, []);
  const selectScene = useCallback((nextId: BistroSceneId): void => {
    writeBistroSceneId(nextId);
    setSceneId(nextId);
  }, []);
  const bistro = useMemo(() => gltf({
    bounds: {
      min: [-3, 0.25, -20.5],
      max: [20, 11, 8.25],
    },
    sceneIndex: selectedScene.sceneIndex,
    src: `${import.meta.env.BASE_URL}BistroWeb/Bistro.gltf`,
    version: "web-draco-avif-v5",
  }), [selectedScene.sceneIndex]);
  const renderScene = useMemo(() => scene({
    camera: orbit.camera,
    environment: materialEnvironment,
    clearColor: [0.018, 0.022, 0.029, 1],
    exposureEv100: materialPass.exposureEv100,
    nodes: [
      directionalLight(materialKeyLight),
      directionalLight(materialFillLight),
      bistro,
    ],
    toneMapping: materialPass.toneMapping,
  }), [bistro, orbit.camera]);

  return (
    <main>
      <header>
        <p className="eyebrow">Royal glTF workload</p>
        <h1>Bistro web tier.</h1>
        <p>
          The ~100 MB Draco + AVIF asset exercises external glTF IO,
          instancing, authored tangents, and canonical material textures.
          {" "}<a href={import.meta.env.BASE_URL}>Back to the direct-surface example</a>.
        </p>
        <label className="bistro-scene-selector">
          Bistro scene
          <select
            value={selectedScene.id}
            onChange={(event) => selectScene(event.currentTarget.value as BistroSceneId)}
          >
            {bistroScenes.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.title}</option>
            ))}
          </select>
        </label>
      </header>
      <section
        className="viewport bistro-viewport"
        data-bistro-scene={selectedScene.id}
        aria-label={`Amazon Lumberyard Bistro web-tier example: ${selectedScene.title}`}
      >
        <Canvas
          aria-label={`Amazon Lumberyard Bistro: ${selectedScene.title}`}
          rendererOptions={exampleCanvasRendererOptions}
          scene={renderScene}
          style={interactiveCanvasStyle}
        >
          <GltfOrbitCameraFit
            node={bistro}
            orbit={orbit}
            padding={1.08}
            pitch={0.35}
            yaw={Math.PI / 4}
          />
          <OrbitControls minDistance={0.08} orbit={orbit} />
          <BistroStatus asset={bistro.asset} />
        </Canvas>
      </section>
      <p className="asset-attribution">
        Amazon Lumberyard Bistro v5.2 © Amazon.com, Inc. or its affiliates,
        licensed under CC BY 4.0. See <a href={`${import.meta.env.BASE_URL}BistroWeb/LICENSE`}>asset attribution</a>.
      </p>
    </main>
  );
};
