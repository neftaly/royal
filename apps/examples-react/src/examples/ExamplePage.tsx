import type { ReactNode } from 'react';
import type { ExampleDefinition } from './types';

export const ExamplePage = ({
  example,
}: {
  readonly example: ExampleDefinition;
}): ReactNode => {
  const Demo = example.Demo;
  const Probe = example.probe;
  const smoke = example.visualSmoke;

  return (
    <section
      className="example-page"
      aria-labelledby="example-title"
      data-example-id={example.id}
      data-example-route={example.path}
      data-smoke-canvas-label={smoke.canvasLabel}
      data-smoke-min-color-buckets={smoke.minColorBuckets}
      data-smoke-min-painted-ratio={smoke.minPaintedRatio}
      data-smoke-readable-text={smoke.readableText.join('\n')}
      data-smoke-surface={smoke.surface}
      data-smoke-text-quality={
        smoke.textQuality === undefined ? undefined : JSON.stringify(smoke.textQuality)
      }
      data-source-export={example.sourceExport}
      data-source-file={example.sourceFile}
    >
      <header className="example-heading">
        <p className="eyebrow">{sectionLabel(example.section)}</p>
        <h1 id="example-title">{example.title}</h1>
        <p>{example.summary}</p>
      </header>
      <div className="example-workbench">
        <div className="demo-panel" aria-label={`${example.title} demo`}>
          <Demo />
        </div>
        <div className="panel-grid">
          <section className="info-panel source-panel" aria-labelledby="source-heading">
            <div className="panel-title-row">
              <h2 id="source-heading">Source</h2>
              <span>{example.sourceFile}</span>
            </div>
            <pre>
              <code>{example.source}</code>
            </pre>
          </section>
          {Probe === undefined ? null : (
            <section className="info-panel" aria-labelledby="probe-heading">
              <h2 id="probe-heading">Probe</h2>
              <Probe />
            </section>
          )}
          <section className="info-panel" aria-labelledby="notes-heading">
            <h2 id="notes-heading">Notes</h2>
            <ul className="notes-list">
              {(example.notes ?? []).map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </section>
  );
};

const sectionLabel = (section: ExampleDefinition['section']): string => {
  switch (section) {
    case 'primary':
      return 'Examples';
    case 'labs-prototypes':
      return 'Labs/Prototypes';
  }
};
