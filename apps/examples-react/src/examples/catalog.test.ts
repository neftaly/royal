import { describe, expect, it } from 'vitest';
import { createElement, isValidElement } from 'react';
import { examples, firstExample } from '../examples';

describe('example catalog', () => {
  it('publishes stable product routes', () => {
    const ids = examples.map((example) => example.id);
    const paths = examples.map((example) => example.path);

    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(paths).size).toBe(paths.length);
    expect(firstExample).toBe(examples[0]);

    for (const example of examples) {
      expect(example.path).toMatch(/^\/[a-z0-9-]+$/);
      expect(example.title.length).toBeGreaterThan(0);
      expect(example.maturity).toBe('product');
    }
  });

  it('can instantiate every product example component', () => {
    for (const example of examples) {
      expect(isValidElement(createElement(example.Component))).toBe(true);
    }
  });
});
