import type { ReactNode } from 'react';

type WipDemoLink = {
  readonly id: string;
  readonly title: string;
  readonly href: string;
  readonly target: 'route' | 'repo';
};

const routeHref = (routePath: string): string =>
  `${import.meta.env.BASE_URL.replace(/\/$/, '')}${routePath}`;
const repoHref = (repoPath: string): string =>
  `https://github.com/neftaly/royal/tree/main/${repoPath}`;

const wipDemoLinks: readonly WipDemoLink[] = [
  {
    id: 'gltf-asset-viewer',
    title: 'glTF Helmet route',
    href: routeHref('/gltf-helmet'),
    target: 'route',
  },
  {
    id: 'picking-raycasting-fuzz',
    title: 'Picking replay fixture',
    href: repoHref('research/picking-fuzz/fixtures/notched-bounds-replay.json'),
    target: 'repo',
  },
  {
    id: 'asset-manifest-contract',
    title: 'Asset manifest contract artifacts',
    href: repoHref('research/asset-manifest-contract'),
    target: 'repo',
  },
  {
    id: 'offline-terrain-pipeline',
    title: 'Offline terrain pipeline artifacts',
    href: repoHref('research/offline-terrain-pipeline'),
    target: 'repo',
  },
  {
    id: 'dynamic-impostors',
    title: 'Dynamic impostor artifacts',
    href: repoHref('research/dynamic-impostors'),
    target: 'repo',
  },
  {
    id: 'virtual-texturing-research',
    title: 'Virtual texturing research artifacts',
    href: repoHref('research/virtual-texturing'),
    target: 'repo',
  },
];

export const WipDemos = (): ReactNode => (
  <section className="wip-page" data-wip-page="">
    <header className="example-heading wip-heading">
      <p>Routes and artifacts</p>
      <h1>WIP Demo Links</h1>
    </header>
    <ul className="wip-link-list">
      {wipDemoLinks.map((demo) => (
        <li key={demo.id}>
          <a
            data-wip-link=""
            data-wip-link-id={demo.id}
            data-wip-link-target={demo.target}
            href={demo.href}
          >
            {demo.title}
          </a>
        </li>
      ))}
    </ul>
  </section>
);
