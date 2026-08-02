import { describe, expect, it } from 'vitest';
import { attributeCapabilities } from '../../scripts/bundle-size-attribution.mjs';

const owns = (name) => ({
  fixture: 'fixture',
  name,
  owns: (id) => id.includes(`/${name}.ts`),
});

describe('bundle capability attribution', () => {
  it('reports whole-chunk gzip upper bounds and matched rendered bytes', () => {
    const result = attributeCapabilities([
      {
        file: 'assets/initial.js',
        gzipBytes: 100,
        initial: true,
        modules: [
          { id: '/src/draco.ts', renderedBytes: 40 },
          { id: '/src/shared.ts', renderedBytes: 60 },
        ],
        worker: false,
      },
      {
        file: 'assets/draco-worker.js',
        gzipBytes: 80,
        initial: false,
        modules: [{ id: '/src/draco.ts', renderedBytes: 50 }],
        worker: true,
      },
    ], [owns('draco')]);

    expect(result.draco.gzipWholeChunkUpperBoundBytes).toEqual({
      initial: 100,
      lazy: 80,
      total: 180,
      worker: 80,
    });
    expect(result.draco.matchedModuleRenderedBytes).toEqual({
      initial: 40,
      lazy: 50,
      total: 90,
      worker: 50,
    });
  });

  it('allows shared chunks to appear in more than one capability', () => {
    const result = attributeCapabilities([{
      file: 'assets/shared.js',
      gzipBytes: 120,
      initial: false,
      modules: [
        { id: '/src/draco.ts', renderedBytes: 30 },
        { id: '/src/environment.ts', renderedBytes: 40 },
      ],
      worker: false,
    }], [owns('environment'), owns('draco')]);

    expect(result.draco.gzipWholeChunkUpperBoundBytes.total).toBe(120);
    expect(result.environment.gzipWholeChunkUpperBoundBytes.total).toBe(120);
    expect(Object.keys(result)).toEqual(['draco', 'environment']);
  });

  it('fails when a capability silently loses every owned module', () => {
    expect(() => attributeCapabilities([], [owns('draco')])).toThrow(
      'Bundle attribution found no emitted modules for draco',
    );
  });

  it('rejects a worker classified as initial', () => {
    expect(() => attributeCapabilities([{
      file: 'assets/draco-worker.js',
      gzipBytes: 80,
      initial: true,
      modules: [{ id: '/src/draco.ts', renderedBytes: 50 }],
      worker: true,
    }], [owns('draco')])).toThrow(
      'Bundle chunk assets/draco-worker.js cannot be both initial and a worker',
    );
  });
});
