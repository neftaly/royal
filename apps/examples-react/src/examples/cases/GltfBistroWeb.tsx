/** @jsxImportSource react */
import {
  Canvas,
  GltfOrbitCameraFit,
  OrbitControls,
  useGltfAssetStatus,
  useOrbitCamera,
} from "@royal/react";
import { directionalLight, gltf, scene } from "@royal/react/scene";
import { useMemo, type ReactNode } from "react";
import { BenchmarkRendererSnapshot } from "../BenchmarkRendererSnapshot";
import { exampleCanvasRendererOptions } from "../example-renderer-options";
import {
  interactiveCanvasStyle,
  materialEnvironment,
  materialFillLight,
  materialKeyLight,
  materialPass,
} from "../presentation";

const bistro = gltf({
  bounds: {
    min: [-3, 0.25, -20.5],
    max: [20, 11, 8.25],
  },
  src: `${import.meta.env.BASE_URL}BistroWeb/Bistro.gltf`,
  version: "web-draco-avif-v5",
});

const bistroNodes = [
  directionalLight(materialKeyLight),
  directionalLight(materialFillLight),
  bistro,
] as const;

const BistroStatus = (): ReactNode => {
  const status = useGltfAssetStatus(bistro.asset);
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
      <BenchmarkRendererSnapshot asset={bistro.asset} status={status} />
      <output className="status" data-gltf-status={status.status}>{value}</output>
    </>
  );
};

export const GltfBistroWeb = (): ReactNode => {
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
  const renderScene = useMemo(() => scene({
    camera: orbit.camera,
    environment: materialEnvironment,
    clearColor: [0.018, 0.022, 0.029, 1],
    exposureEv100: materialPass.exposureEv100,
    nodes: bistroNodes,
    toneMapping: materialPass.toneMapping,
  }), [orbit.camera]);

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
      </header>
      <section className="viewport bistro-viewport" aria-label="Amazon Lumberyard Bistro web-tier example">
        <Canvas
          aria-label="Amazon Lumberyard Bistro"
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
          <BistroStatus />
        </Canvas>
      </section>
      <p className="asset-attribution">
        Amazon Lumberyard Bistro v5.2 © Amazon.com, Inc. or its affiliates,
        licensed under CC BY 4.0. See <a href={`${import.meta.env.BASE_URL}BistroWeb/LICENSE`}>asset attribution</a>.
      </p>
    </main>
  );
};
