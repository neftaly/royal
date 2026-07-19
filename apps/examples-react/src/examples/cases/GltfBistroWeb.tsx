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

const bistro = gltf({
  bounds: {
    min: [-3, 0.25, -20.5],
    max: [20, 11, 8.25],
  },
  src: `${import.meta.env.BASE_URL}BistroWeb/Bistro.gltf`,
  version: "web-draco-avif-v5",
});

const bistroNodes = [
  directionalLight({
    color: [1, 0.96, 0.9, 1],
    direction: [0.45, -0.78, -0.43],
    illuminanceLux: 4,
  }),
  directionalLight({
    color: [0.55, 0.7, 1, 1],
    direction: [-0.66, -0.24, 0.71],
    illuminanceLux: 1.2,
  }),
  bistro,
] as const;

const BistroStatus = (): ReactNode => {
  const status = useGltfAssetStatus(bistro.asset);
  let value: string = status.state;
  if (
    status.state === "ready"
    || status.state === "streaming"
    || status.state === "degraded"
  ) {
    const failed = status.textures.failed === 0
      ? ""
      : ` · ${status.textures.failed} failed`;
    value = `${status.state} · ${status.primitiveCount} primitives · ${status.textures.ready}/${status.textures.total} textures${failed}`;
  } else if (status.state === "error") value = `error · ${status.error}`;
  return (
    <>
      <BenchmarkRendererSnapshot asset={bistro.asset} status={status} />
      <output className="status" data-gltf-state={status.state}>{value}</output>
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
    camera: orbit.cameraResource,
    clearColor: [0.018, 0.022, 0.029, 1],
    nodes: bistroNodes,
    toneMapping: "pbr-neutral",
  }), [orbit.cameraResource]);

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
        <Canvas aria-label="Amazon Lumberyard Bistro" scene={renderScene}>
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
