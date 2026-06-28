import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Shell } from './Shell';
import {
  exampleCatalog,
  firstExample,
} from './examples/catalog';
import { ExamplePage } from './examples/ExamplePage';
import type { ExampleDefinition } from './examples/types';

const pageFor = (example: ExampleDefinition): (() => ReactNode) =>
  () => <ExamplePage example={example} />;

const rootRoute = createRootRoute({
  component: Shell
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: firstExample.path });
  }
});

const exampleRoutes = exampleCatalog.map((example) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: example.path,
    component: pageFor(example)
  })
);

const routeTree = rootRoute.addChildren([indexRoute, ...exampleRoutes]);
const basepath = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

export const router = createRouter({ basepath, routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
