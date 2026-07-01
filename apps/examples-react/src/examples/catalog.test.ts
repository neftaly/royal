import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createElement, isValidElement } from 'react';
import { examples, firstExample, type Example } from '../examples';

const exampleCasesDirectory = new URL('./cases/', import.meta.url);

const exampleSourceFiles = (directory: URL): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryUrl = new URL(entry.name, directory);

    if (entry.isDirectory()) {
      return exampleSourceFiles(new URL(`${entry.name}/`, directory));
    }

    return entry.isFile() && /\.tsx?$/.test(entry.name)
      ? [entryUrl.pathname]
      : [];
  });

describe('example catalog', () => {
  it('publishes stable example routes', () => {
    const ids = examples.map((example) => example.id);
    const paths = examples.map((example) => example.path);
    const maturities: readonly Example['maturity'][] = examples.map((example) => example.maturity);

    expect(ids).toEqual([
      'cube',
      'wireframe',
      'text',
      'form-controls',
      'texture-materials',
      'virtual-texture',
      'gltf-helmet',
    ]);
    expect(paths).toEqual([
      '/cube',
      '/wireframe',
      '/text',
      '/form-controls',
      '/texture-materials',
      '/virtual-texture',
      '/gltf-helmet',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(paths).size).toBe(paths.length);
    expect(firstExample).toBe(examples[0]);
    expect(maturities).toEqual([
      'product',
      'product',
      'product',
      'product',
      'product',
      'product',
      'product',
    ]);
    expect(maturities).not.toContain('lab-probe');

    for (const example of examples) {
      expect(example.path).toMatch(/^\/[a-z0-9-]+$/);
      expect(example.title.length).toBeGreaterThan(0);
      expect(example.maturity).toBe('product');
    }
  });

  it('can instantiate every example component', () => {
    for (const example of examples) {
      expect(isValidElement(createElement(example.Component))).toBe(true);
    }
  });

  it('uses JSX for Canvas in example cases', () => {
    const offenders = exampleSourceFiles(exampleCasesDirectory).filter((file) =>
      /\bcreateElement\s*\(\s*Canvas\b/.test(readFileSync(file, 'utf8'))
    );

    expect(offenders.map((file) => path.relative(process.cwd(), file))).toEqual([]);
  });

  it('uses preferred React API names in example cases', () => {
    const offenders = exampleSourceFiles(exampleCasesDirectory).filter((file) =>
      /\brootOptions\b|\binitialView\b/.test(readFileSync(file, 'utf8'))
    );

    expect(offenders.map((file) => path.relative(process.cwd(), file))).toEqual([]);
  });
});
