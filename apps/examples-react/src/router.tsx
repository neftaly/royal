import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Shell } from './Shell';
import { WipDemos } from './WipDemos';
import { examples, firstExample, type Example } from './examples';

const ExampleScreen = ({ example }: { readonly example: Example }): ReactNode => {
  const Demo = example.Component;

  return (
    <section
      className="example-page"
      data-example-id={example.id}
      data-example-route={example.path}
      data-source-file={example.sourceFile}
    >
      <header className="example-heading">
        <h1>{example.title}</h1>
      </header>
      <div className="example-workbench">
        <section className="demo-panel" aria-label={`${example.title} preview`}>
          <Demo />
        </section>
        <section className="source-panel" aria-label={`${example.title} source`}>
          <div className="panel-title-row">
            <h2>Source</h2>
            <span>{example.sourceFile}</span>
          </div>
          <pre>
            <code>{example.source}</code>
          </pre>
        </section>
      </div>
    </section>
  );
};

const pageFor = (example: Example): (() => ReactNode) =>
  () => <ExampleScreen example={example} />;

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

const exampleRoutes = examples.map((example) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: example.path,
    component: pageFor(example)
  })
);

const wipRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/wip',
  component: WipDemos
});

const routeTree = rootRoute.addChildren([indexRoute, ...exampleRoutes, wipRoute]);
const basepath = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

export const router = createRouter({ basepath, routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
