/** @jsxImportSource react */
import { StrictMode, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  Canvas,
  type ScenePointerEvents,
  useCanvasSize,
  useRendererLifecycle,
} from "@royal/react";
import {
  boxGeometry,
  mesh,
  perspectiveCamera,
  planeGeometry,
  scene,
  unlitMaterial,
} from "@royal/react/scene";
import "./style.css";

const blue = unlitMaterial({ color: [0.04, 0.32, 0.9, 1] });
const coral = unlitMaterial({ color: [0.9, 0.12, 0.07, 1] });
const gold = unlitMaterial({ color: [0.95, 0.55, 0.06, 1] });
const directScene = scene({
  camera: perspectiveCamera({ position: [0, 0, 6] }),
  clearColor: [0.035, 0.07, 0.14, 1],
  nodes: [
    mesh({
      geometry: boxGeometry([1.5, 1.5, 1.5]),
      material: blue,
      pickingId: "blue-box",
      transform: { position: [-1.35, 0.2, 0], rotation: [0.35, 0.55, 0.1] },
    }),
    mesh({
      geometry: boxGeometry([1.1, 2.1, 0.8]),
      material: coral,
      pickingId: "coral-box",
      transform: { position: [1.2, 0, -0.5], rotation: [-0.2, -0.45, 0.15] },
    }),
    mesh({
      geometry: planeGeometry([5.2, 0.32]),
      material: gold,
      pickingId: "gold-plane",
      transform: { position: [0, -1.55, -0.2] },
    }),
  ],
});

const RendererStatus = (): ReactNode => {
  const lifecycle = useRendererLifecycle();
  const size = useCanvasSize();
  return (
    <output className="status" data-royal-lifecycle={lifecycle.state}>
      {lifecycle.state} · {size === undefined
        ? "waiting for layout"
        : `${size.backingWidth}×${size.backingHeight} backing pixels`}
    </output>
  );
};

const App = (): ReactNode => {
  const [lastPick, setLastPick] = useState("click a surface");
  const scenePointerEvents = useMemo<ScenePointerEvents>(() => ({
    "blue-box": { onClick: () => setLastPick("blue box") },
    "coral-box": { onClick: () => setLastPick("coral box") },
    "gold-plane": { onClick: () => setLastPick("gold plane") },
  }), []);
  return (
    <main>
      <header>
        <p className="eyebrow">Royal renderer replacement</p>
        <h1>One canonical surface path.</h1>
        <p>Direct planes and boxes lower to the same retained triangle ABI and root-owned WebGL state.</p>
      </header>
      <section className="viewport" aria-label="Renderer lifecycle example">
        <Canvas
          aria-label="Royal direct surface scene"
          scene={directScene}
          scenePointerEvents={scenePointerEvents}
        >
          <output className="pick-status">picked · {lastPick}</output>
          <RendererStatus />
        </Canvas>
      </section>
    </main>
  );
};

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("Expected #root element");
createRoot(rootElement).render(<StrictMode><App /></StrictMode>);
