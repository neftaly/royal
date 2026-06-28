import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { examples, firstExample } from '../examples';

const srcDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const normalizeSource = (source: string): string => source.replace(/\r\n/g, '\n');

describe('examples list', () => {
  it('keeps the menu small and ordered', () => {
    expect(firstExample).toBe(examples[0]);
    expect(examples.map((example) => example.title)).toEqual([
      'Cube',
      'Wireframe',
      'Fake UI + Text/Yoga',
      'Virtual Texturing Terrain',
    ]);
    expect(examples.map((example) => example.path)).toEqual([
      '/cube',
      '/wireframe',
      '/fake-ui-text',
      '/virtual-texturing',
    ]);
  });

  it('keeps every entry uniquely routable with source text', () => {
    const ids = new Set<string>();
    const paths = new Set<string>();

    for (const example of examples) {
      expect(example.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(example.path).toMatch(/^\//);
      expect(ids.has(example.id)).toBe(false);
      expect(paths.has(example.path)).toBe(false);
      expect(typeof example.Component).toBe('function');
      expect(example.source.trim()).not.toBe('');
      expect(example.sourceFile).toBe(`examples/cases/${example.Component.name}.tsx`);

      ids.add(example.id);
      paths.add(example.path);
    }
  });

  it('derives every source panel from the matching real example file', async () => {
    await Promise.all(
      examples.map(async (example) => {
        const sourcePath = path.join(srcDir, example.sourceFile);
        const source = await readFile(sourcePath, 'utf8');

        expect(normalizeSource(example.source)).toBe(normalizeSource(source));
        expect(example.source).toContain('export const ' + example.Component.name);
      }),
    );
  });

  it('keeps Tarstate out of the primary examples app', () => {
    expect(examples.some((example) => example.source.includes('@royal/tarstate-lens'))).toBe(false);
    expect(examples.some((example) => example.title.toLowerCase().includes('tarstate'))).toBe(false);
  });

  it('keeps the fake UI route Yoga-ready without wiring controls', () => {
    const fakeUi = examples.find((example) => example.id === 'fake-ui-text');

    expect(fakeUi?.source).toContain('Yoga is not exposed to the examples app yet');
    expect(fakeUi?.source).toContain('aria-label="Zoom"');
    expect(fakeUi?.source).toContain('disabled');
  });

  it('keeps the virtual texturing route honest while renderer hooks are absent', () => {
    const vt = examples.find((example) => example.id === 'virtual-texturing-terrain');

    expect(vt?.path).toBe('/virtual-texturing');
    expect(vt?.source).toContain(
      'Research fixture preview; renderer VT hooks are not active in this route.',
    );
    expect(vt?.source).toContain('page-cache-debug-overlay.svg');
    expect(vt?.source).not.toContain('VirtualTextureNode');
  });
});
