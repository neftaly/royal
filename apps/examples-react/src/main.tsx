/** @jsxImportSource react */
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { Router } from './router';
import './style.css';

const rootElement = document.getElementById('root');
const lifecycleProbeEnabled = new URLSearchParams(globalThis.location.search)
  .has('__royalReactLifecycleProbe');
const ReactLifecycleProbe = lazy(() => import('./testing/ReactLifecycleProbe')
  .then((module) => ({ default: module.ReactLifecycleProbe })));

if (rootElement === null) {
  throw new Error('Expected #root element');
}

createRoot(rootElement).render(
  <StrictMode>
    {lifecycleProbeEnabled
      ? <Suspense fallback={<output>Loading lifecycle probe…</output>}><ReactLifecycleProbe /></Suspense>
      : <Router />}
  </StrictMode>
);
