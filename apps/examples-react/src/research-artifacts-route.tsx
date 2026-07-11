/** @jsxImportSource react */
import { lazy, Suspense, type ReactNode } from 'react';

const ResearchArtifacts = lazy(() => import('./ResearchArtifacts').then((module) => ({
  default: module.ResearchArtifacts,
})));

export const ResearchArtifactsRoute = (): ReactNode => (
  <Suspense fallback={<output>Loading research artifacts…</output>}>
    <ResearchArtifacts />
  </Suspense>
);
