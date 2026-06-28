import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { exampleCatalog, exampleSections, firstExample } from './catalog';

const examplesDir = path.dirname(new URL(import.meta.url).pathname);
const normalizeSource = (source: string): string => source.replace(/\r\n/g, '\n');

describe('example catalog', () => {
  it('keeps every catalog entry runnable and uniquely routable', () => {
    expect(exampleCatalog.length).toBeGreaterThan(0);
    expect(firstExample).toBe(exampleCatalog[0]);

    const ids = new Set<string>();
    const paths = new Set<string>();

    for (const example of exampleCatalog) {
      expect(example.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(example.path).toMatch(/^\//);
      expect(ids.has(example.id)).toBe(false);
      expect(paths.has(example.path)).toBe(false);
      expect(typeof example.Demo).toBe('function');
      expect(example.Demo.name).toMatch(/^[A-Z]/);
      expect(example.source.trim()).not.toBe('');
      expect(example.sourceFile).toBe(`cases/${example.Demo.name}.tsx`);
      expect(example.sourceExport).toBe(example.Demo.name);
      expect(example.visualSmoke.readableText.length).toBeGreaterThan(0);
      expect(example.visualSmoke.readableText).toContain(example.title);
      if (example.visualSmoke.surface === 'canvas') {
        expect(example.visualSmoke.canvasLabel).toEqual(expect.any(String));
      }

      ids.add(example.id);
      paths.add(example.path);
    }
  });

  it('derives every source panel from the matching real example file', async () => {
    await Promise.all(
      exampleCatalog.map(async (example) => {
        const sourcePath = path.join(examplesDir, 'cases', example.Demo.name + '.tsx');
        const source = await readFile(sourcePath, 'utf8');

        expect(normalizeSource(example.source)).toBe(normalizeSource(source));
        expect(example.source).toContain('export const ' + example.Demo.name);
        expect(example.source).toContain('export const ' + example.sourceExport);
      }),
    );
  });

  it('assigns every catalog entry to exactly one visible section', () => {
    const sectionedIds = exampleSections.flatMap((section) =>
      section.examples.map((example) => example.id),
    );

    expect(sectionedIds).toHaveLength(exampleCatalog.length);
    expect(new Set(sectionedIds)).toEqual(
      new Set(exampleCatalog.map((example) => example.id)),
    );
  });

  it('keeps the text prototype route useful for visual text acceptance', () => {
    const textPrototype = exampleCatalog.find((example) => example.id === 'text-prototype');

    expect(textPrototype?.visualSmoke.readableText).toContain('AV office 108%.');
    expect(textPrototype?.visualSmoke.textQuality?.acceptanceText).toBe('AV office 108%.');
    expect(textPrototype?.visualSmoke.textQuality?.warnThresholds.minEdgeTransitions).toBeGreaterThan(0);
  });
});
