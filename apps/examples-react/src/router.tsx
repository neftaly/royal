/** @jsxImportSource react */
import { useEffect, useState, type ReactNode } from 'react';
import { ResearchArtifactsRoute } from './research-artifacts-route';
import { Shell } from './Shell';
import { examples, firstExample, type Example, type LoadedExample } from './examples';
import { exampleHref, pathWithinExamplesBase } from './route-path';

const currentPath = (): string | undefined => pathWithinExamplesBase(globalThis.location.pathname);

const benchmarkEnabled = (): boolean =>
  new URLSearchParams(globalThis.location.search).get('bench') === 'auto';

type BenchmarkModule = typeof import('./examples/BrowserBenchmarkReporter');

const ExampleScreen = ({ example }: { readonly example: Example }): ReactNode => {
  const [loaded, setLoaded] = useState<LoadedExample | undefined>();
  const [benchmark, setBenchmark] = useState<BenchmarkModule | undefined>();
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    let active = true;
    const benchmarkImport = benchmarkEnabled()
      ? import('./examples/BrowserBenchmarkReporter')
      : Promise.resolve(undefined);
    void Promise.all([example.load(), benchmarkImport]).then(([next, benchmarkModule]) => {
      if (!active) return;
      benchmarkModule?.installBrowserBenchmarkHooks();
      setBenchmark(benchmarkModule);
      setLoaded(next);
    }).catch((failure: unknown) => {
      if (active) setError(failure);
    });
    return () => {
      active = false;
    };
  }, [example]);

  if (error !== undefined) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return <output className="example-load-error">Unable to load example: {message}</output>;
  }
  if (loaded === undefined) return <output className="example-load-status">Loading example…</output>;

  const Demo = loaded.Component;
  const BenchmarkReporter = benchmark?.BrowserBenchmarkReporter;
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
      {BenchmarkReporter === undefined ? null : <BenchmarkReporter example={example} />}
      <div className="example-workbench">
        <section className="demo-panel" aria-label={`${example.title} preview`}>
          <Demo />
        </section>
        <section className="source-panel" aria-label={`${example.title} source`}>
          <div className="panel-title-row">
            <h2>Source</h2>
            <span>{example.sourceFile}</span>
          </div>
          <pre><code>{loaded.source}</code></pre>
        </section>
      </div>
    </section>
  );
};

const routeContent = (path: string | undefined): ReactNode => {
  if (path === '/artifacts') return <ResearchArtifactsRoute />;
  const example = examples.find((candidate) => candidate.path === path);
  if (example !== undefined) return <ExampleScreen example={example} key={example.id} />;
  return (
    <section className="example-page" data-not-found="">
      <header className="example-heading"><h1>Example not found</h1></header>
      <p>No Royal example exists at this path.</p>
    </section>
  );
};

const initialPath = (): string | undefined => {
  const path = currentPath();
  if (path !== '/') return path;
  globalThis.history.replaceState(null, '', `${exampleHref(firstExample.path)}${globalThis.location.search}${globalThis.location.hash}`);
  return firstExample.path;
};

export const Router = (): ReactNode => {
  const [path, setPath] = useState(initialPath);
  useEffect(() => {
    const sync = (): void => setPath(currentPath());
    globalThis.addEventListener('popstate', sync);
    return () => globalThis.removeEventListener('popstate', sync);
  }, []);

  const navigate = (nextPath: string): void => {
    const resolved = nextPath === '/' ? firstExample.path : nextPath;
    if (resolved === path) return;
    globalThis.history.pushState(null, '', exampleHref(resolved));
    setPath(resolved);
  };

  return <Shell currentPath={path} navigate={navigate}>{routeContent(path)}</Shell>;
};
