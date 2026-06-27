import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import type { ComponentType, ReactNode } from 'react';
import { Shell } from './Shell';
import Cube from './pages/Cube';
import Gltf from './pages/Gltf';
import Index from './pages/Index';
import Wireframe from './pages/Wireframe';

const page = (Page: ComponentType): (() => ReactNode) =>
  () => <Page />;

const rootRoute = createRootRoute({
  component: Shell
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: page(Index)
});

const cubeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cube',
  component: page(Cube)
});

const gltfRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/gltf',
  component: page(Gltf)
});

const wireframeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/wireframe',
  component: page(Wireframe)
});

const routeTree = rootRoute.addChildren([indexRoute, cubeRoute, gltfRoute, wireframeRoute]);
const basepath = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

export const router = createRouter({ basepath, routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
