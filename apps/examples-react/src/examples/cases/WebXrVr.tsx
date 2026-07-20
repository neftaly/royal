import { Canvas, useGltfAssetStatus } from "@royal/react";
import {
  boxGeometry,
  directionalLight,
  gltf,
  mesh,
  perspectiveCamera,
  planeGeometry,
  scene,
  standardMaterial,
  studioEnvironment,
} from "@royal/react/scene";
import { useXrSession } from "@royal/react/xr";
import { type ReactNode } from "react";
import { BenchmarkRendererSnapshot } from "../BenchmarkRendererSnapshot";

const xrTiger = gltf({
  src: `${import.meta.env.BASE_URL}fixtures/gltf-svg-texture/ghostscript-tiger-card.gltf`,
  transform: { position: [0, 1.6, -3.8], scale: [13, 13, 13] },
});

const renderScene = scene({
  camera: perspectiveCamera({
    far: 60,
    fovY: 0.9,
    near: 0.05,
    position: [0, 1.6, 4],
  }),
  clearColor: [0.015, 0.025, 0.055, 1],
  environment: studioEnvironment({ radianceScaleNits: 1.5 }),
  nodes: [
    directionalLight({ direction: [0.35, -0.8, -0.45], illuminanceLux: 6 }),
    mesh({
      geometry: planeGeometry([16, 16]),
      material: standardMaterial({ color: [0.16, 0.19, 0.24, 1], roughness: 0.9 }),
      transform: { position: [0, 0, -3], rotation: [-Math.PI / 2, 0, 0] },
    }),
    mesh({
      geometry: boxGeometry([0.8, 0.8, 0.8]),
      material: standardMaterial({ color: [0.05, 0.62, 0.5, 1], roughness: 0.35 }),
      transform: { position: [-1.15, 0.45, -2.2], rotation: [0.1, 0.5, 0] },
    }),
    mesh({
      geometry: boxGeometry([1, 1.2, 0.75]),
      material: standardMaterial({ color: [0.82, 0.16, 0.08, 1], roughness: 0.5 }),
      transform: { position: [1.1, 0.62, -2.8], rotation: [-0.1, -0.35, 0.08] },
    }),
    xrTiger,
  ],
  toneMapping: "pbr-neutral",
});

const XrControls = (): ReactNode => {
  const xr = useXrSession({
    mode: "immersive-vr",
    renderer: {
      referenceSpacePreference: ["local-floor", "local"],
      webGlLayer: { framebufferScaleFactor: 1 },
    },
    session: { optionalFeatures: ["local-floor", "bounded-floor"] },
  });
  const live = xr.status === "active" || xr.status === "suspended" || xr.status === "ending";
  const busy = xr.status === "checking" || xr.status === "starting" || xr.status === "ending";
  return (
    <div className="xr-session-control" data-royal-xr-status={xr.status}>
      <button
        className="xr-session-button"
        disabled={busy || xr.status === "unavailable"}
        onClick={() => { void (live ? xr.exit() : xr.enter()); }}
        type="button"
      >
        {xr.status === "starting" ? "Entering XR…" : xr.status === "ending"
          ? "Exiting XR…" : live ? "Exit XR" : "Enter XR"}
      </button>
      <span className="xr-session-status">{xr.error ?? xr.status}</span>
    </div>
  );
};

const XrBenchmark = (): ReactNode => {
  const status = useGltfAssetStatus(xrTiger.asset);
  return <BenchmarkRendererSnapshot asset={xrTiger.asset} status={status} />;
};

/** Direct and glTF surfaces rendered through the same canvas/XR canonical path. */
export const WebXrVr = (): ReactNode => (
  <main>
    <header>
      <p className="eyebrow">Royal WebXR</p>
      <h1>One scene, ordered stereo views.</h1>
      <p>The browser session borrows the canvas context and owns the only active frame clock.</p>
    </header>
    <section className="viewport" aria-label="WebXR renderer example">
      <Canvas aria-label="Royal WebXR scene" className="webxr-vr-canvas" scene={renderScene}>
        <XrBenchmark />
        <XrControls />
      </Canvas>
    </section>
  </main>
);
