import { imageTexture, mesh, orthographicCamera, planeGeometry, scene, unlitMaterial } from "../packages/renderer-core/dist/index.js";
import { createRendererRoot } from "../packages/renderer-webgl/dist/index.js";

// Distinct encoded artwork and storage identities: this is not a shared-texture instancing test.
const params = new URLSearchParams(location.search);
const count = Number(params.get("count") ?? 3240);
const budget = Number(params.get("budget") ?? 64) * 1024 * 1024;
const canvas = document.querySelector("canvas");
const root = createRendererRoot(canvas, { persistentGpuByteBudget: budget });
root.setSize({ cssWidth: 768, cssHeight: 768, pixelRatio: 1 });
const geometry = planeGeometry(0.48);
const nodes = Array.from({ length: count }, (_, index) => {
  const art = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="hsl(${index * 137.5 % 360},65%,45%)"/><path d="M0 0L1024 1024M0 1024L1024 0" stroke="white" stroke-width="20"/><text x="80" y="550" font-size="180">${index}</text></svg>`;
  return mesh({ geometry, material: unlitMaterial({ texture: imageTexture(`data:image/svg+xml,${encodeURIComponent(art)}`) }),
    transform: { position: [Math.floor(index / 324) * 100 + index % 18 * 0.5 - 4.25,
      Math.floor(index % 324 / 18) * 0.5 - 4.25, 0] } });
});
const show = (group) => root.setScene(scene({ nodes,
  camera: orthographicCamera({ position: [group * 100, 0, 3], left: -5, right: 5, bottom: -5, top: 5 }) }));
const samples = [];
let started = performance.now();
const snapshot = () => ({ elapsedMs: performance.now() - started, count, budget, renderer: root.getSnapshot(), lifecycle: root.getLifecycleSnapshot() });
Object.assign(window, { textureWorkingSet: { root, show: (group) => { started = performance.now(); show(group); }, snapshot, samples,
  resetTimer: () => { started = performance.now(); },
  resize: (size) => { started = performance.now(); root.setSize({ cssWidth: size, cssHeight: size, pixelRatio: 1 }); } } });
show(0);
setInterval(() => {
  const sample = snapshot();
  if (samples.length < 600) samples.push(sample);
  document.querySelector("#status").textContent = JSON.stringify(sample, null, 2);
}, 1000);
