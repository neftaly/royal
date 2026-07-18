/** @jsxImportSource react */
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  Canvas,
  useCanvasSize,
  useRendererLifecycle,
} from "@royal/react";
import { perspectiveCamera, scene } from "@royal/react/scene";
import "./style.css";

const clearScene = scene({
  camera: perspectiveCamera({ position: [0, 0, 3] }),
  clearColor: [0.035, 0.07, 0.14, 1],
  nodes: [],
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

const App = (): ReactNode => (
  <main>
    <header>
      <p className="eyebrow">Royal renderer replacement</p>
      <h1>One lifecycle. One frame spine.</h1>
      <p>The first vertical slice proves canvas ownership, sizing, recovery, and clear-state execution.</p>
    </header>
    <section className="viewport" aria-label="Renderer lifecycle example">
      <Canvas aria-label="Royal clear scene" scene={clearScene}>
        <RendererStatus />
      </Canvas>
    </section>
  </main>
);

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("Expected #root element");
createRoot(rootElement).render(<StrictMode><App /></StrictMode>);
