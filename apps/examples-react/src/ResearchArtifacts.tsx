import type { ReactNode } from 'react';

export type ResearchArtifactAsset = {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly kind: 'json' | 'image' | 'svg' | 'html';
};

export type ResearchArtifact = {
  readonly id: string;
  readonly title: string;
  readonly eyebrow: string;
  readonly summary: string;
  readonly metrics: readonly string[];
  readonly assets: readonly ResearchArtifactAsset[];
  readonly preview?: {
    readonly alt: string;
    readonly href: string;
    readonly kind: 'image' | 'svg';
  };
};

const publicHref = (path: string): string =>
  `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;

export const researchArtifacts: readonly ResearchArtifact[] = [
  {
    id: 'picking-raycasting-fuzz',
    title: 'Picking replay fixture',
    eyebrow: 'Hit testing',
    summary:
      'A replayable notched-bounds contract fixture with expected and observed pointer hits.',
    metrics: ['4 replay rows', 'fixture-css-px pointer space', 'visible-mask oracle'],
    assets: [
      {
        id: 'picking-replay-json',
        label: 'Replay JSON',
        href: publicHref('artifacts/picking-fuzz/fixtures/notched-bounds-replay.json'),
        kind: 'json',
      },
    ],
  },
  {
    id: 'asset-manifest-contract',
    title: 'Asset manifest contract fixtures',
    eyebrow: 'Manifest contract',
    summary:
      'Normalized fixture outputs for the unstable research asset contract, kept separate from primary demos.',
    metrics: ['3 normalized fixtures', '21 referenced artifacts', '14 bounds records'],
    assets: [
      {
        id: 'asset-contract-schema',
        label: 'Contract schema',
        href: publicHref('artifacts/asset-manifest-contract/asset-manifest-contract.schema.json'),
        kind: 'json',
      },
      {
        id: 'asset-contract-vt',
        label: 'Virtual texturing fixture',
        href: publicHref(
          'artifacts/asset-manifest-contract/fixtures/virtual-texturing.normalized.json',
        ),
        kind: 'json',
      },
      {
        id: 'asset-contract-terrain',
        label: 'Offline terrain fixture',
        href: publicHref(
          'artifacts/asset-manifest-contract/fixtures/offline-terrain.normalized.json',
        ),
        kind: 'json',
      },
      {
        id: 'asset-contract-impostors',
        label: 'Dynamic impostors fixture',
        href: publicHref(
          'artifacts/asset-manifest-contract/fixtures/dynamic-impostors.normalized.json',
        ),
        kind: 'json',
      },
    ],
  },
  {
    id: 'offline-terrain-pipeline',
    title: 'Offline terrain pipeline fixtures',
    eyebrow: 'Terrain packaging',
    summary:
      'Tracked terrain world and manifest fixtures that describe tile identity, LOD, mesh, and material slots.',
    metrics: ['4 world-index tiles', '1 sample mesh record', '4 material texture records'],
    assets: [
      {
        id: 'offline-terrain-manifest',
        label: 'Sample manifest',
        href: publicHref('artifacts/offline-terrain-pipeline/fixtures/sample-manifest.json'),
        kind: 'json',
      },
      {
        id: 'offline-terrain-world-index',
        label: 'World index',
        href: publicHref('artifacts/offline-terrain-pipeline/fixtures/world-index.json'),
        kind: 'json',
      },
      {
        id: 'offline-terrain-schema',
        label: 'Manifest schema',
        href: publicHref(
          'artifacts/offline-terrain-pipeline/offline-terrain-manifest.schema.json',
        ),
        kind: 'json',
      },
    ],
  },
  {
    id: 'dynamic-impostors',
    title: 'Dynamic impostor manifest',
    eyebrow: 'LOD residency',
    summary:
      'A forest impostor pressure-test manifest with source mesh, atlas, and runtime budget inputs.',
    metrics: ['3 source mesh records', '2 impostor atlases', '72 default camera frames'],
    assets: [
      {
        id: 'dynamic-impostors-manifest',
        label: 'Forest manifest',
        href: publicHref(
          'artifacts/dynamic-impostors/fixtures/sample-forest-impostor-manifest.json',
        ),
        kind: 'json',
      },
    ],
  },
  {
    id: 'virtual-texturing-research',
    title: 'Virtual texturing assets',
    eyebrow: 'Streaming research',
    summary:
      'Checked-in demo-readiness assets for page manifests, cache statistics, debug overlays, and preview imagery.',
    metrics: ['21 texture pages', '3 mip levels', '12 cache slots'],
    preview: {
      alt: 'Virtual texture terrain page overview',
      href: publicHref('artifacts/virtual-texturing/demo-assets/preview/terrain-pages-overview.png'),
      kind: 'image',
    },
    assets: [
      {
        id: 'vt-manifest',
        label: 'Page manifest',
        href: publicHref('artifacts/virtual-texturing/demo-assets/manifest.json'),
        kind: 'json',
      },
      {
        id: 'vt-example-fixture',
        label: 'Example fixture',
        href: publicHref('artifacts/virtual-texturing/demo-assets/example-fixture.json'),
        kind: 'json',
      },
      {
        id: 'vt-camera-stats',
        label: 'Camera stream stats',
        href: publicHref('artifacts/virtual-texturing/demo-assets/stats/camera-pan-stream.json'),
        kind: 'json',
      },
      {
        id: 'vt-overview',
        label: 'Terrain page overview',
        href: publicHref('artifacts/virtual-texturing/demo-assets/preview/terrain-pages-overview.png'),
        kind: 'image',
      },
      {
        id: 'vt-debug-overlay',
        label: 'Cache debug overlay',
        href: publicHref(
          'artifacts/virtual-texturing/demo-assets/preview/page-cache-debug-overlay.svg',
        ),
        kind: 'svg',
      },
      {
        id: 'vt-report',
        label: 'Readiness report',
        href: publicHref('artifacts/virtual-texturing/demo-assets/report/index.html'),
        kind: 'html',
      },
    ],
  },
];

const relatedRoutes = [
  {
    href: `${import.meta.env.BASE_URL.replace(/\/$/, '')}/gltf-helmet`,
    label: 'glTF Helmet real example route',
  },
] as const;

export const ResearchArtifacts = (): ReactNode => (
  <section className="artifacts-page" data-artifacts-page="">
    <header className="example-heading artifacts-heading">
      <p>Research only</p>
      <h1>Research Artifacts</h1>
      <span>
        These are checked-in research outputs served by the examples app. They are useful for
        inspection and smoke coverage, but they are not promoted as primary renderer demos.
      </span>
    </header>
    <div className="artifacts-grid">
      {researchArtifacts.map((artifact) => (
        <article className="artifact-card" data-artifact-id={artifact.id} key={artifact.id}>
          <div className="artifact-card-copy">
            <p>{artifact.eyebrow}</p>
            <h2>{artifact.title}</h2>
            <span>{artifact.summary}</span>
            <ul className="artifact-metrics" aria-label={`${artifact.title} summary`}>
              {artifact.metrics.map((metric) => (
                <li key={metric}>{metric}</li>
              ))}
            </ul>
          </div>
          {artifact.preview === undefined ? null : (
            <a className="artifact-preview" href={artifact.preview.href}>
              <img
                alt={artifact.preview.alt}
                data-artifact-preview=""
                data-artifact-preview-id={artifact.id}
                src={artifact.preview.href}
              />
            </a>
          )}
          <ul className="artifacts-link-list">
            {artifact.assets.map((asset) => (
              <li key={asset.id}>
                <a
                  data-artifact-asset=""
                  data-artifact-asset-id={asset.id}
                  data-artifact-asset-kind={asset.kind}
                  data-artifact-id={artifact.id}
                  href={asset.href}
                >
                  {asset.label}
                </a>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
    <section className="artifacts-related" aria-label="Related real examples">
      <h2>Related Real Example</h2>
      {relatedRoutes.map((route) => (
        <a data-artifact-related-route="" href={route.href} key={route.href}>
          {route.label}
        </a>
      ))}
    </section>
  </section>
);
