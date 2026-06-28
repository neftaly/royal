import { useEffect, useState, type ReactNode } from 'react';

const fixtureUrl = new URL(
  '../../../public/virtual-texturing/example-fixture.json',
  import.meta.url,
).href;
const overviewUrl = new URL(
  '../../../public/virtual-texturing/preview/terrain-pages-overview.png',
  import.meta.url,
).href;
const overlayUrl = new URL(
  '../../../public/virtual-texturing/preview/page-cache-debug-overlay.svg',
  import.meta.url,
).href;
const statsUrl = new URL(
  '../../../public/virtual-texturing/stats/camera-pan-stream.json',
  import.meta.url,
).href;

const rendererStatus =
  'Research fixture preview; renderer VT hooks are not active in this route.';

type Fixture = {
  readonly statsSummary: {
    readonly exactHitRatio: number;
    readonly fallbackRatio: number;
    readonly averageUploads: number;
    readonly totalEvictions: number;
    readonly averagePageTableUpdates: number;
    readonly maxSeamCandidates: number;
  };
  readonly virtualTexture: {
    readonly assetId: string;
    readonly dimensions: readonly [number, number];
    readonly usableTileSize: number;
    readonly mipCount: number;
    readonly seamSafety: {
      readonly mismatches: number;
    };
  };
};

const fallbackFixture: Fixture = {
  statsSummary: {
    exactHitRatio: 0.747,
    fallbackRatio: 0.014,
    averageUploads: 3,
    totalEvictions: 6,
    averagePageTableUpdates: 4,
    maxSeamCandidates: 45,
  },
  virtualTexture: {
    assetId: 'royal.generated-terrain-material.vt-demo',
    dimensions: [128, 128],
    usableTileSize: 32,
    mipCount: 3,
    seamSafety: { mismatches: 0 },
  },
};

const percent = (value: number): string => `${Math.round(value * 1000) / 10}%`;

export const VirtualTexturingTerrain = (): ReactNode => {
  const [fixture, setFixture] = useState<Fixture>(fallbackFixture);

  useEffect(() => {
    let active = true;
    void fetch(fixtureUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Fixture fetch failed: ${response.status}`);
        return response.json() as Promise<Fixture>;
      })
      .then((loadedFixture) => {
        if (active) setFixture(loadedFixture);
      })
      .catch(() => {
        if (active) setFixture(fallbackFixture);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="vt-preview" data-vt-status={rendererStatus}>
      <div className="vt-images">
        <figure>
          <img
            alt="Virtual terrain material pages overview"
            data-fixture-image="terrain-pages-overview"
            src={overviewUrl}
          />
          <figcaption>Terrain pages overview</figcaption>
        </figure>
        <figure className="vt-overlay-preview">
          <img
            alt="Page cache debug overlay preview"
            data-fixture-image="page-cache-debug-overlay"
            src={overlayUrl}
          />
          <figcaption>Debug overlay preview</figcaption>
        </figure>
      </div>

      <div className="vt-status">
        <p>{rendererStatus}</p>
        <dl>
          <div>
            <dt>Asset</dt>
            <dd>{fixture.virtualTexture.assetId}</dd>
          </div>
          <div>
            <dt>Texture</dt>
            <dd>
              {fixture.virtualTexture.dimensions.join(' x ')} px, {fixture.virtualTexture.mipCount} mips
            </dd>
          </div>
          <div>
            <dt>Tile size</dt>
            <dd>{fixture.virtualTexture.usableTileSize} px usable</dd>
          </div>
          <div>
            <dt>Exact hits</dt>
            <dd>{percent(fixture.statsSummary.exactHitRatio)}</dd>
          </div>
          <div>
            <dt>Fallback samples</dt>
            <dd>{percent(fixture.statsSummary.fallbackRatio)}</dd>
          </div>
          <div>
            <dt>Average uploads</dt>
            <dd>{fixture.statsSummary.averageUploads} pages/frame</dd>
          </div>
          <div>
            <dt>Evictions</dt>
            <dd>{fixture.statsSummary.totalEvictions}</dd>
          </div>
          <div>
            <dt>Page-table updates</dt>
            <dd>{fixture.statsSummary.averagePageTableUpdates} average</dd>
          </div>
          <div>
            <dt>Seam candidates</dt>
            <dd>{fixture.statsSummary.maxSeamCandidates}</dd>
          </div>
          <div>
            <dt>Border mismatches</dt>
            <dd>{fixture.virtualTexture.seamSafety.mismatches}</dd>
          </div>
        </dl>
        <a href={statsUrl}>camera-pan-stream.json</a>
      </div>
    </div>
  );
};
