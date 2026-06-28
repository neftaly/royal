import type { ReactNode } from 'react';

type WipDemoLink = {
  readonly id: string;
  readonly title: string;
  readonly status: 'Artifact available' | 'Harness available' | 'Pending demo route';
  readonly summary: string;
  readonly repoPath?: string;
};

const wipDemoLinks: readonly WipDemoLink[] = [
  {
    id: 'gltf-asset-viewer',
    title: 'glTF Asset Viewer',
    status: 'Artifact available',
    summary:
      'DamagedHelmet is kept as a repo fixture for renderer glTF work. A browser viewer route is still pending.',
    repoPath: 'fixtures/DamagedHelmet/DamagedHelmet.gltf',
  },
  {
    id: 'picking-raycasting-fuzz',
    title: 'Picking / Raycasting Fuzz',
    status: 'Harness available',
    summary:
      'The browser-independent oracle exists under research; the examples app does not yet expose the interactive adapter.',
    repoPath: 'research/picking-fuzz/picking-fuzz-harness.mjs',
  },
  {
    id: 'offline-terrain-pipeline',
    title: 'Offline Terrain Pipeline',
    status: 'Pending demo route',
    summary:
      'Terrain preprocessing work is reserved for research artifacts until a stable examples route exists.',
    repoPath: 'research/offline-terrain-pipeline/**',
  },
  {
    id: 'dynamic-impostors',
    title: 'Dynamic Impostors',
    status: 'Pending demo route',
    summary:
      'Dynamic impostor experiments remain WIP research material and are not part of the primary examples list.',
    repoPath: 'research/dynamic-impostors/**',
  },
  {
    id: 'live-virtual-texturing-hooks',
    title: 'Live Virtual Texturing Hooks',
    status: 'Pending demo route',
    summary:
      'The primary VT page intentionally stays a fixture preview until renderer hooks are wired into the app.',
  },
  {
    id: 'shader-postprocess',
    title: 'Shader / Postprocess',
    status: 'Pending demo route',
    summary:
      'Shader source exists in renderer packages, but there is no stable examples route for postprocess iteration yet.',
  },
  {
    id: 'typography-raster-atlas',
    title: 'Typography / Raster Atlas',
    status: 'Pending demo route',
    summary:
      'Text rendering is visible in the Fake UI route; atlas diagnostics remain future WIP material.',
  },
  {
    id: 'capability-diagnostics',
    title: 'Capability Diagnostics',
    status: 'Pending demo route',
    summary:
      'GPU and platform capability checks are useful WIP targets, but they are not part of the primary examples list.',
  },
];

const WipDemoCard = ({ demo }: { readonly demo: WipDemoLink }): ReactNode => (
  <article className="wip-card" data-wip-demo-id={demo.id}>
    <div className="wip-card-heading">
      <h2>{demo.title}</h2>
      <span>{demo.status}</span>
    </div>
    <p>{demo.summary}</p>
    {demo.repoPath === undefined ? null : (
      <div className="wip-path">
        <span>Repo path</span>
        <code>{demo.repoPath}</code>
      </div>
    )}
  </article>
);

export const WipDemos = (): ReactNode => (
  <section className="wip-page" data-wip-page="">
    <header className="example-heading wip-heading">
      <p>Separate from stable examples</p>
      <h1>WIP Demo Links</h1>
    </header>
    <div className="wip-grid">
      {wipDemoLinks.map((demo) => (
        <WipDemoCard key={demo.id} demo={demo} />
      ))}
    </div>
  </section>
);
