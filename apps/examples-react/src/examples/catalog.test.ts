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
      'Text',
      'Texture Materials',
      'glTF Helmet',
    ]);
    expect(examples.map((example) => example.path)).toEqual([
      '/cube',
      '/wireframe',
      '/text',
      '/texture-materials',
      '/gltf-helmet',
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

  it('keeps primary renderer examples on JSX scene authoring', () => {
    for (const example of examples) {
      expect(example.source).not.toMatch(/\bscene\s*\(\s*\{/);
      expect(example.source).not.toMatch(/\bpass\s*\(\s*\{/);
    }
  });

  it('keeps Tarstate out of the primary examples app', () => {
    expect(examples.some((example) => example.source.includes('@royal/tarstate-lens'))).toBe(false);
    expect(examples.some((example) => example.title.toLowerCase().includes('tarstate'))).toBe(false);
  });

  it('keeps research artifacts out of the primary examples list', () => {
    expect(examples.some((example) => String(example.path) === '/artifacts')).toBe(false);
    expect(examples.some((example) => String(example.path) === '/wip')).toBe(false);
    expect(examples.some((example) => example.title.toLowerCase().includes('research'))).toBe(
      false,
    );
    expect(examples.some((example) => example.title.toLowerCase().includes('wip'))).toBe(false);
    expect(examples).toHaveLength(5);
  });

  it('keeps fixture-only VT out of primary examples', () => {
    expect(examples.some((example) => String(example.path) === '/virtual-texturing')).toBe(false);
    expect(examples.some((example) => example.id.includes('virtual-texturing'))).toBe(false);
    expect(examples.some((example) => example.source.includes('page-cache-debug-overlay'))).toBe(
      false,
    );
    expect(examples.some((example) => example.source.includes('Research fixture preview'))).toBe(
      false,
    );
  });

  it('keeps fake and compatibility text demos out of primary examples', () => {
    expect(examples.some((example) => String(example.path) === '/fake-ui-text')).toBe(false);
    expect(
      examples.some((example) =>
        /FakeUiText|Yoga|glyphs|vectorText/.test(example.source),
      ),
    ).toBe(false);
  });

  it('keeps the text route on renderer-backed font APIs', () => {
    const textExample = examples.find((example) => example.id === 'text');

    expect(textExample?.path).toBe('/text');
    expect(textExample?.source).toContain('createTextFontFace');
    expect(textExample?.source).toContain("font={font}");
    expect(textExample?.source).toContain('<text');
    expect(textExample?.source).toContain(
      "import fontUrl from '../../assets/atkinson-hyperlegible-latin-400-normal.woff?url'",
    );
    expect(textExample?.source).not.toMatch(/\bscene\s*\(\s*\{/);
    expect(textExample?.source).not.toMatch(/\bpass\s*\(\s*\{/);
  });

  it('keeps the DamagedHelmet route on the public glTF API subset', () => {
    const helmet = examples.find((example) => example.id === 'gltf-helmet');

    expect(helmet?.path).toBe('/gltf-helmet');
    expect(helmet?.source).toContain('<gltf');
    expect(helmet?.source).toContain("import.meta.env.BASE_URL + 'DamagedHelmet/DamagedHelmet.gltf'");
    expect(helmet?.source).toContain('asset={helmetAsset}');
    expect(helmet?.source).toContain('directionalLight');
    expect(helmet?.source).toContain('perspectiveCamera');
  });

  it('keeps the texture materials route on real material and texture APIs', () => {
    const materials = examples.find((example) => example.id === 'texture-materials');

    expect(materials?.path).toBe('/texture-materials');
    expect(materials?.source).toContain('standardMaterial');
    expect(materials?.source).toContain('unlitMaterial');
    expect(materials?.source).toContain('solidTexture');
    expect(materials?.source).toContain('textureAsset');
    expect(materials?.source).toContain("fallback: fallbackTexture");
    expect(materials?.source).toContain(
      "import.meta.env.BASE_URL + 'DamagedHelmet/Default_albedo.jpg'",
    );
    expect(materials?.source).toContain('<mesh');
  });

  it('keeps the wireframe route on the backend WebGL wireframe path', () => {
    const wireframe = examples.find((example) => example.id === 'wireframe');

    expect(wireframe?.path).toBe('/wireframe');
    expect(wireframe?.source).toContain('wireframeMaterial');
    expect(wireframe?.source).toContain('<mesh');
    expect(wireframe?.source).not.toContain('barGeometry');
    expect(wireframe?.source).not.toMatch(/\bMeshLine\b|\bmeshline\b/);
  });
});
