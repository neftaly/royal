import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { examples, firstExample, type Example } from '../examples';

const srcDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const normalizeSource = (source: string): string => source.replace(/\r\n/g, '\n');
const createElementTargets = (source: string): readonly string[] =>
  [...source.matchAll(/\b(?:React\.)?createElement\s*\(\s*([^,\s)]+)/g)]
    .map((match) => match[1])
    .filter((target): target is string => target !== undefined);
const isVirtualTexturingExample = (example: Example): boolean =>
  example.id.includes('virtual-texturing') ||
  example.title.toLowerCase().includes('virtual textur');
const lineNumberAtOffset = (source: string, offset: number): number =>
  source.slice(0, offset).split('\n').length;
const compactSourceMatch = (source: string): string => source.replace(/\s+/g, ' ').trim();
const readCaseSource = (sourceFile: string): Promise<string> =>
  readFile(path.join(srcDir, 'examples/cases', sourceFile), 'utf8');
const readVirtualTexturingSourceParts = async (): Promise<{
  readonly combinedSource: string;
  readonly hostSource: string;
  readonly sceneSource: string;
  readonly textureSource: string;
}> => {
  const [hostSource, sceneSource, textureSource] = await Promise.all([
    readCaseSource('VirtualTexturingPlane.tsx'),
    readCaseSource('VirtualTexturingPlane.scene.tsx'),
    readCaseSource('VirtualTexturingPlane.texture.ts'),
  ]);

  return {
    combinedSource: [hostSource, sceneSource, textureSource].join('\n'),
    hostSource,
    sceneSource,
    textureSource,
  };
};

const readFormControlsSourceParts = async (): Promise<{
  readonly combinedSource: string;
  readonly hostSource: string;
  readonly modelSource: string;
  readonly sceneSource: string;
}> => {
  const [hostSource, modelSource, sceneSource] = await Promise.all([
    readCaseSource('FormControls.tsx'),
    readCaseSource('FormControls.model.ts'),
    readCaseSource('FormControls.scene.tsx'),
  ]);

  return {
    combinedSource: [hostSource, modelSource, sceneSource].join('\n'),
    hostSource,
    modelSource,
    sceneSource,
  };
};

const readSimpleSceneParts = async (
  componentName: 'GltfHelmet' | 'TextureMaterials' | 'WireframeCube',
): Promise<{
  readonly hostSource: string;
  readonly sceneSource: string;
}> => {
  const [hostSource, sceneSource] = await Promise.all([
    readCaseSource(`${componentName}.tsx`),
    readCaseSource(`${componentName}.scene.tsx`),
  ]);

  return { hostSource, sceneSource };
};

type ExampleResearchBoundaryHit = {
  readonly exampleId: string;
  readonly kind: string;
  readonly line: number;
  readonly sourceFile: string;
  readonly text: string;
};

const forbiddenExampleResearchBoundaryPatterns = [
  {
    kind: 'research fixture path',
    pattern: /\b(?:(?:\.\.\/)*research\/[^'"`\s)]*\/fixtures\/[^'"`\s)]*)/g,
  },
  {
    kind: 'public artifact path',
    pattern: /\b(?:apps\/examples-react\/public\/artifacts|\/?artifacts\/[^'"`\s)]*)/g,
  },
  {
    kind: 'renderer WebGPU package',
    pattern: /@royal\/renderer-webgpu(?:\/[^'"`\s)]*)?/g,
  },
  {
    kind: 'renderer testing subpath',
    pattern: /@royal\/renderer-[a-z0-9-]+(?:\/[^'"`\s)]*)?\/testing(?:\/[^'"`\s)]*)?/g,
  },
] as const;

const exampleResearchBoundaryHits = (example: Example): readonly ExampleResearchBoundaryHit[] =>
  forbiddenExampleResearchBoundaryPatterns.flatMap(({ kind, pattern }) =>
    [...example.source.matchAll(pattern)].map((match) => ({
      exampleId: example.id,
      kind,
      line: lineNumberAtOffset(example.source, match.index ?? 0),
      sourceFile: example.sourceFile,
      text: compactSourceMatch(match[0] ?? ''),
    })),
  );

type CanvasOnlyDomViolation = {
  readonly exampleId: string;
  readonly kind: string;
  readonly line: number;
  readonly match: string;
  readonly sourceFile: string;
};

type ExampleSourceViolation = {
  readonly exampleId: string;
  readonly kind: string;
  readonly line: number;
  readonly match: string;
  readonly sourceFile: string;
};

type ExampleSourcePattern = {
  readonly kind: string;
  readonly pattern: RegExp;
};

const domControlTagPattern = /<\s*(button|fieldset|form|input|output|select|textarea)\b[^>]*(?:\/>|>)/gi;
const forbiddenCanvasOnlyDomPatterns = [
  {
    kind: 'contentEditable DOM editing surface',
    pattern: /\bcontentEditable\b\s*=|\bcontenteditable\b\s*=/gi,
  },
  {
    kind: 'DOM form control factory',
    pattern: /\b(?:React\.)?createElement\s*\(\s*['"`](?:button|fieldset|form|input|output|select|textarea)['"`]/gi,
  },
  {
    kind: 'DOM form control type',
    pattern:
      /\b(?:HTMLButtonElement|HTMLFieldSetElement|HTMLFormElement|HTMLInputElement|HTMLOutputElement|HTMLSelectElement|HTMLTextAreaElement)\b/g,
  },
  {
    kind: 'hidden file picker bridge',
    pattern: /\b(?:fileInput|fileInputRef|hiddenFileInput|hiddenFilePicker|inputFileBridge)\b/gi,
  },
  {
    kind: 'hidden clipboard bridge',
    pattern:
      /\b(?:ClipboardFallback|clipboard-bridge|clipboardBridge|clipboardBridgeRef|clipboardCache|clipboardTextarea|hiddenClipboardTextarea|internalClipboard|internalClipboardRef|pasteInternalClipboardText|renderer-text-clipboard-bridge)\b/gi,
  },
  {
    kind: 'DOM context menu bridge',
    pattern:
      /\b(?:domContextMenu|DomContextMenu|htmlContextMenu|HtmlContextMenu|contextMenuElement|contextMenuRef|renderer-text-context-menu)\b/gi,
  },
  {
    kind: 'DOM context menu element',
    pattern:
      /<\s*(?:div|menu|ul)\b[^>]*(?:context-menu|role\s*=\s*["']menu["'])[^>]*(?:\/>|>)/gi,
  },
  {
    kind: 'document contextmenu listener',
    pattern: /\b(?:document|window)\.addEventListener\s*\(\s*['"`]contextmenu['"`]/gi,
  },
] as const;
const alwaysForbiddenResearchOnlyExamplePatterns = [
  {
    kind: 'custom shader material API',
    pattern: /\b(?:customShaderMaterial|shaderUniform|shaderAttribute)\b/g,
  },
  {
    kind: 'dynamic impostor public API',
    pattern: /\b(?:DynamicImpostorNode|dynamicImpostor)\b/g,
  },
  {
    kind: 'virtual texture public node',
    pattern: /\bVirtualTextureNode\b/g,
  },
  {
    kind: 'public LOD knobs or nodes',
    pattern:
      /\b(?:LODNode|LodNode|lodNode|LevelOfDetailNode|levelOfDetail|dynamicLod|lodLevel|lodRange|lodThreshold|lodDistance|lodPolicy|lodBias|lodBudget)\b/g,
  },
  {
    kind: 'form-control renderer descriptor',
    pattern: /\b(?:FormControl|formControl)\b|(?<![\w$.])(?:button|fieldset|form|input|output|select|textarea)\s*\(/g,
  },
] as const satisfies readonly ExampleSourcePattern[];
const productOnlyResearchOnlyExamplePatterns = [
  {
    kind: 'testing package import',
    pattern: /@royal\/[^'"\s]*\/testing\b/g,
  },
  {
    kind: 'virtual-texturing testing import',
    pattern: /@royal\/renderer-webgl\/virtual-texturing\/testing\b/g,
  },
  {
    kind: 'research or fixture import',
    pattern: /\bfrom\s+['"`][^'"`]*(?:research|fixtures?|__fixtures__|\.test)[^'"`]*['"`]/g,
  },
  {
    kind: 'low-level virtual-texturing handle',
    pattern:
      /\b(?:VirtualTextureRuntime|VirtualTexturePageAddress|VirtualTexturePageId|VirtualTexturePhysicalAtlasPageUpload|VirtualTexturePageTableTexture|VirtualTexturePageTableTexelUpload|createVirtualTexturePageTableTexture|planVirtualTextureUploads|uploadVirtualTexturePageTableTexels|virtualTexturePageId|virtualTexturePageTableMipDimensions|PageCache|pageCache|page-cache|PageTable|pageTable|page-table|texSubImage2D)\b/g,
  },
] as const satisfies readonly ExampleSourcePattern[];

const canvasOnlyDomViolations = (example: Example): readonly CanvasOnlyDomViolation[] => {
  const tagViolations = [...example.source.matchAll(domControlTagPattern)].map((match) => {
    const tagName = match[1] ?? 'unknown';
    const sourceMatch = match[0] ?? '';

    return {
      exampleId: example.id,
      kind: `JSX <${tagName}> control`,
      line: lineNumberAtOffset(example.source, match.index ?? 0),
      match: compactSourceMatch(sourceMatch),
      sourceFile: example.sourceFile,
    };
  });

  const patternViolations = forbiddenCanvasOnlyDomPatterns.flatMap(({ kind, pattern }) =>
    [...example.source.matchAll(pattern)].map((match) => ({
      exampleId: example.id,
      kind,
      line: lineNumberAtOffset(example.source, match.index ?? 0),
      match: compactSourceMatch(match[0] ?? ''),
      sourceFile: example.sourceFile,
    })),
  );

  return [...tagViolations, ...patternViolations];
};

const exampleSourceViolations = (
  example: Example,
  patterns: readonly ExampleSourcePattern[],
): readonly ExampleSourceViolation[] =>
  patterns.flatMap(({ kind, pattern }) =>
    [...example.source.matchAll(pattern)].map((match) => ({
      exampleId: example.id,
      kind,
      line: lineNumberAtOffset(example.source, match.index ?? 0),
      match: compactSourceMatch(match[0] ?? ''),
      sourceFile: example.sourceFile,
    })),
  );

const publicCanvasOnlyDomViolation = ({
  exampleId,
  kind,
  line,
  match,
  sourceFile,
}: CanvasOnlyDomViolation): Omit<CanvasOnlyDomViolation, 'match'> & { readonly text: string } => ({
  exampleId,
  kind,
  line,
  sourceFile,
  text: match,
});

const publicExampleSourceViolation = ({
  exampleId,
  kind,
  line,
  match,
  sourceFile,
}: ExampleSourceViolation): Omit<ExampleSourceViolation, 'match'> & { readonly text: string } => ({
  exampleId,
  kind,
  line,
  sourceFile,
  text: match,
});

describe('examples list', () => {
  it('keeps the menu small and ordered', () => {
    expect(firstExample).toBe(examples[0]);
    expect(examples.map((example) => example.title)).toEqual([
      'Cube',
      'Wireframe',
      'Text',
      'Form Controls',
      'Texture Materials',
      'Virtual Texturing',
      'glTF Helmet',
    ]);
    expect(examples.map((example) => example.path)).toEqual([
      '/cube',
      '/wireframe',
      '/text',
      '/form-controls',
      '/texture-materials',
      '/virtual-texturing',
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
      expect(['product', 'lab-probe']).toContain(example.maturity);
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

  it('keeps the HelloCube Royal JSX scene separate from its React host component', async () => {
    const [hostSource, sceneSource] = await Promise.all([
      readFile(path.join(srcDir, 'examples/cases/HelloCube.tsx'), 'utf8'),
      readFile(path.join(srcDir, 'examples/cases/HelloCube.scene.tsx'), 'utf8'),
    ]);

    expect(hostSource).not.toContain('@jsxImportSource @royal/react');
    expect(hostSource).toContain('<Canvas aria-label="Lit cube" rootOptions={rootOptions}>');
    expect(hostSource).toContain('{helloCubeScene()}');
    expect(hostSource).not.toMatch(/\b(?:React\.)?createElement\s*\(\s*Canvas\b/);

    expect(sceneSource).toContain('/** @jsxImportSource @royal/react */');
    expect(sceneSource).toContain('export const helloCubeScene = (): RenderRoot =>');
    expect(sceneSource).toContain('<scene>');
    expect(sceneSource).toContain('<mesh');
    expect(sceneSource).not.toMatch(/\bCanvas\b/);
    expect(sceneSource).not.toMatch(/\bfrom\s+['"]react['"]/);
  });

  it('keeps the VirtualTexturingPlane Royal JSX scene separate from its React host component', async () => {
    const { hostSource, sceneSource, textureSource } = await readVirtualTexturingSourceParts();

    expect(hostSource).not.toContain('@jsxImportSource @royal/react');
    expect(hostSource).toContain('<Canvas');
    expect(hostSource).toContain('{virtualTexturingScene(surfaceMaterial, view)}');
    expect(hostSource).not.toMatch(/\b(?:React\.)?createElement\s*\(\s*Canvas\b/);
    expect(hostSource).not.toContain('@royal/renderer-core');

    expect(sceneSource).toContain('/** @jsxImportSource @royal/react */');
    expect(sceneSource).toContain('export const virtualTexturingScene = (');
    expect(sceneSource).toContain('<scene>');
    expect(sceneSource).toContain('<mesh');
    expect(sceneSource).toContain('rotation: [view.rotation[0], view.rotation[1], 0]');
    expect(sceneSource).not.toMatch(/\bCanvas\b/);
    expect(sceneSource).not.toMatch(/\bfrom\s+['"]react['"]/);

    expect(textureSource).toContain('export const createSurfaceMaterial = (): UnlitMaterial =>');
    expect(textureSource).toContain('createGeneratedTextureUri');
    expect(textureSource).toContain('virtualTextureAsset({');
    expect(textureSource).toContain('textureAsset({');
  });

  it('keeps simple Royal JSX scenes separate from their React host components', async () => {
    const cases = [
      {
        componentName: 'WireframeCube',
        hostCall: '{wireframeScene(frame)}',
        sceneExport: 'export const wireframeScene = (frame: number): RenderRoot =>',
      },
      {
        componentName: 'GltfHelmet',
        hostCall: '{helmetScene()}',
        sceneExport: 'export const helmetScene = (): RenderRoot =>',
      },
      {
        componentName: 'TextureMaterials',
        hostCall: '{materialScene()}',
        sceneExport: 'export const materialScene = (): RenderRoot =>',
      },
    ] as const;

    for (const { componentName, hostCall, sceneExport } of cases) {
      const { hostSource, sceneSource } = await readSimpleSceneParts(componentName);

      expect(hostSource).not.toContain('@jsxImportSource @royal/react');
      expect(hostSource).toContain('<Canvas');
      expect(hostSource).toContain(hostCall);
      expect(hostSource).not.toMatch(/\b(?:React\.)?createElement\s*\(\s*Canvas\b/);
      expect(hostSource).not.toContain('@royal/renderer-core');

      expect(sceneSource).toContain('/** @jsxImportSource @royal/react */');
      expect(sceneSource).toContain(sceneExport);
      expect(sceneSource).toContain('<scene>');
      expect(sceneSource).not.toMatch(/\bCanvas\b/);
      expect(sceneSource).not.toMatch(/\bfrom\s+['"]react['"]/);
    }
  });

  it('keeps the FormControls route on canvas-native Royal primitives', async () => {
    const formControls = examples.find((example) => example.id === 'form-controls');
    const { combinedSource, hostSource, modelSource, sceneSource } =
      await readFormControlsSourceParts();

    expect(formControls?.path).toBe('/form-controls');
    expect(formControls?.title).toBe('Form Controls');
    expect(formControls?.maturity).toBe('product');
    expect(hostSource).not.toContain('@jsxImportSource @royal/react');
    expect(hostSource).toContain('<Canvas aria-label="Canvas-native form controls"');
    expect(hostSource).toContain('useAtkinsonFont');
    expect(hostSource).toContain('{formControlsScene(font)}');
    expect(hostSource).not.toMatch(/\b(?:React\.)?createElement\s*\(\s*Canvas\b/);
    expect(hostSource).not.toContain('@royal/renderer-core');

    expect(sceneSource).toContain('/** @jsxImportSource @royal/react */');
    expect(sceneSource).toContain('export const formControlsScene = (font?: TextFontFace): RenderRoot =>');
    expect(sceneSource).toContain('<scene>');
    expect(sceneSource).toContain('<orthographicCamera');
    expect(sceneSource).toContain('<mesh');
    expect(sceneSource).toContain('<text');
    expect(sceneSource).toContain('createEditableTextFragment');
    expect(sceneSource).toContain('boxGeometry');
    expect(sceneSource).toContain('unlitMaterial');
    expect(sceneSource).not.toMatch(/\bCanvas\b/);
    expect(sceneSource).not.toMatch(/\bfrom\s+['"]react['"]/);

    expect(modelSource).toContain("export type EditableTextMode = 'single-line' | 'multiline'");
    expect(modelSource).toContain('type EditableTextControlModel');
    expect(modelSource).toContain('createEditableTextControl');
    expect(modelSource).toContain('readonly mode: EditableTextMode');
    expect(modelSource).toContain("mode: 'single-line'");
    expect(modelSource).toContain("mode: 'multiline'");
    expect(modelSource).toContain('readonly placeholder: string');
    expect(modelSource).toContain('readonly value: string');
    expect(modelSource).toContain('readonly selection: EditableTextSelection');
    expect(modelSource).toContain('uiNodeSemantics');
    expect(modelSource).toContain('readonly semantics: Readonly<Record<string, UiNodeSemantics>>');
    expect(modelSource).toContain("command: 'browser.filePicker.request'");
    expect(sceneSource).toContain('control.mode === ');
    expect(sceneSource).not.toContain('selectedRangeWidth');
    expect(combinedSource).not.toMatch(
      /<\s*(?:button|fieldset|form|input|output|select|textarea)\b|\b(?:React\.)?createElement\s*\(\s*['"`](?:button|fieldset|form|input|output|select|textarea)['"`]/i,
    );
    expect(combinedSource).not.toMatch(
      /\b(?:HTMLButtonElement|HTMLFieldSetElement|HTMLFormElement|HTMLInputElement|HTMLOutputElement|HTMLSelectElement|HTMLTextAreaElement|contentEditable|contenteditable|fileInput|fileInputRef|hiddenFileInput|hiddenFilePicker|inputFileBridge)\b/,
    );
  });

  it('keeps primary renderer examples on JSX scene authoring', () => {
    for (const example of examples) {
      expect(example.source).not.toMatch(/\bscene\s*\(\s*\{/);
      expect(example.source).not.toMatch(/\bpass\s*\(\s*\{/);
    }
  });

  it('keeps example DOM UI out of createElement trees', () => {
    for (const example of examples) {
      const nonCanvasTargets = createElementTargets(example.source)
        .filter((target) => target !== 'Canvas');

      expect(nonCanvasTargets).toEqual([]);
    }
  });

  it('keeps canvas-only example source free of DOM controls and fallback bridges', () => {
    const violations = examples.flatMap((example) =>
      canvasOnlyDomViolations(example).map(publicCanvasOnlyDomViolation),
    );

    expect(violations).toEqual([]);
  });

  it('keeps research-only feature names out of primary example source', () => {
    const violations = examples.flatMap((example) =>
      exampleSourceViolations(example, alwaysForbiddenResearchOnlyExamplePatterns)
        .map(publicExampleSourceViolation),
    );

    expect(violations).toEqual([]);
  });

  it('keeps product examples away from testing imports, research fixtures, and VT internals', () => {
    const violations = examples
      .filter((example) => example.maturity === 'product')
      .flatMap((example) =>
        exampleSourceViolations(example, productOnlyResearchOnlyExamplePatterns)
          .map(publicExampleSourceViolation),
      );

    expect(violations).toEqual([]);
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
    expect(examples.map((example) => example.maturity)).toEqual(
      examples.map(() => 'product'),
    );
    expect(examples).toHaveLength(7);
  });

  it('keeps fixture-only VT artifacts out of primary examples', () => {
    const virtualTexturing = examples.find((example) => example.id === 'virtual-texturing');

    expect(virtualTexturing?.path).toBe('/virtual-texturing');
    expect(virtualTexturing?.maturity).toBe('product');
    expect(examples.some((example) => example.source.includes('page-cache-debug-overlay'))).toBe(
      false,
    );
    expect(examples.some((example) => example.source.includes('Research fixture preview'))).toBe(
      false,
    );
  });

  it('keeps product examples clear of research artifacts and renderer probe APIs', () => {
    const violations = examples
      .filter((example) => example.maturity === 'product')
      .flatMap(exampleResearchBoundaryHits);

    expect(violations).toEqual([]);
  });

  it('has no lab probe research boundary exemptions', () => {
    const labProbeHits = examples
      .filter((example) => example.maturity !== 'product')
      .flatMap(exampleResearchBoundaryHits);

    expect(labProbeHits).toEqual([]);
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
    const textInputCount = textExample?.source.match(/type: 'text'/g)?.length ?? 0;
    const fontSizeSliderCount = textExample?.source.match(/type: 'range'/g)?.length ?? 0;

    expect(textExample?.path).toBe('/text');
    expect(textExample?.source).toContain('useAtkinsonFont');
    expect(textExample?.source).toContain("font={font}");
    expect(textExample?.source).toContain('<text');
    expect(textExample?.source).toContain("role: 'textbox'");
    expect(textExample?.source).toContain('onKeyDown: handleCanvasKeyDown');
    expect(textExample?.source).toContain('onCopy: handleCanvasCopy');
    expect(textExample?.source).toContain('onCut: handleCanvasCut');
    expect(textInputCount).toBe(0);
    expect(fontSizeSliderCount).toBe(0);
    expect(textExample?.source).toContain('onPaste: handleCanvasPaste');
    expect(textExample?.source).toContain('onContextMenu: handleCanvasContextMenu');
    expect(textExample?.source).toContain('contextMenuNodes');
    expect(textExample?.source).toContain('contextMenuCommands');
    expect(textExample?.source).toContain('contextMenuCommandAt');
    expect(textExample?.source).toContain('event.clipboardData.setData');
    expect(textExample?.source).toContain('event.clipboardData.getData');
    expect(textExample?.source).toContain('await clipboard.writeText(text)');
    expect(textExample?.source).toContain('await clipboard.readText()');
    expect(textExample?.source).not.toContain("writeTextToSystemClipboard(selectedText, 'copy', 'native')");
    expect(textExample?.source).not.toContain("writeTextToSystemClipboard(cutText, 'cut', 'native')");
    expect(textExample?.source).not.toContain("readTextFromNativeClipboard('native')");
    expect(textExample?.source).not.toMatch(
      /\b(?:HTMLInputElement|HTMLTextAreaElement|contentEditable|contenteditable|textarea|input|createHtmlElement)\b/,
    );
    expect(textExample?.source).not.toMatch(
      /\b(?:clipboardBridgeRef|internalClipboardRef|pasteInternalClipboardText|clipboardCache|internalClipboard|ClipboardFallback|fallback)\b/,
    );
    expect(textExample?.source).not.toContain('renderer-text-context-menu');
    expect(textExample?.source).not.toContain('renderer-text-clipboard-bridge');
    expect(textExample?.source).toContain('selectedText');
    expect(textExample?.source).toContain('clipboard: ClipboardState');
    expect(textExample?.source).toContain('menu: {');
    expect(textExample?.source).toContain("import { useAtkinsonFont } from './text-font'");
    expect(textExample?.source).not.toContain('atkinson-hyperlegible-latin-400-normal.woff?url');
    expect(textExample?.source).not.toMatch(/\bscene\s*\(\s*\{/);
    expect(textExample?.source).not.toMatch(/\bpass\s*\(\s*\{/);
  });

  it('keeps the DamagedHelmet route on the public glTF API subset', async () => {
    const helmet = examples.find((example) => example.id === 'gltf-helmet');
    const { sceneSource } = await readSimpleSceneParts('GltfHelmet');

    expect(helmet?.path).toBe('/gltf-helmet');
    expect(sceneSource).toContain('<gltf');
    expect(sceneSource).toContain("import.meta.env.BASE_URL + 'DamagedHelmet/DamagedHelmet.gltf'");
    expect(sceneSource).toContain('asset={helmetAsset}');
    expect(sceneSource).toContain('directionalLight');
    expect(sceneSource).toContain('perspectiveCamera');
  });

  it('keeps the texture materials route on the textured material API', async () => {
    const materials = examples.find((example) => example.id === 'texture-materials');
    const { sceneSource } = await readSimpleSceneParts('TextureMaterials');

    expect(materials?.path).toBe('/texture-materials');
    expect(sceneSource).toContain('standardMaterial');
    expect(sceneSource).toContain('solidTexture');
    expect(sceneSource).toContain('textureAsset');
    expect(sceneSource).toContain("fallback: fallbackTexture");
    expect(sceneSource).toContain(
      "import.meta.env.BASE_URL + 'DamagedHelmet/Default_albedo.jpg'",
    );
    expect(sceneSource).toContain('<mesh');
  });

  it('keeps the wireframe route on the backend WebGL wireframe path', async () => {
    const wireframe = examples.find((example) => example.id === 'wireframe');
    const { sceneSource } = await readSimpleSceneParts('WireframeCube');

    expect(wireframe?.path).toBe('/wireframe');
    expect(sceneSource).toContain('wireframeMaterial');
    expect(sceneSource).toContain('<mesh');
    expect(sceneSource).not.toContain('barGeometry');
    expect(sceneSource).not.toMatch(/\bMeshLine\b|\bmeshline\b/);
  });

  it('keeps the virtual texturing route on a focused product texture example', async () => {
    const virtualTexturing = examples.find((example) => example.id === 'virtual-texturing');
    const { combinedSource, hostSource, sceneSource, textureSource } =
      await readVirtualTexturingSourceParts();

    expect(virtualTexturing?.maturity).toBe('product');
    expect(virtualTexturing?.path).toBe('/virtual-texturing');
    expect(virtualTexturing?.title).toBe('Virtual Texturing');
    expect(virtualTexturing?.sourceFile).toBe('examples/cases/VirtualTexturingPlane.tsx');
    expect(hostSource).toContain("type DragMode = 'pan' | 'rotate'");
    expect(hostSource).toContain('onWheel');
    expect(hostSource).toContain('onPointerDown');
    expect(hostSource).toContain('onContextMenu');
    expect(hostSource).toContain('onDoubleClick');
    expect(hostSource).toContain('clampRotation');
    expect(sceneSource).toContain('boxGeometry');
    expect(sceneSource).toContain('rotation: [view.rotation[0], view.rotation[1], 0]');
    expect(sceneSource).toContain('<mesh');
    expect(textureSource).toContain('solidTexture');
    expect(textureSource).toContain('virtualTextureAsset');
    expect(textureSource).toContain('textureAsset');
    expect(textureSource).toContain('fallback: fallbackTexture');
    expect(textureSource).toContain('unlitMaterial');
    expect(textureSource).toContain('createGeneratedTextureUri');
    expect(combinedSource).not.toContain('@royal/renderer-webgl');
    expect(combinedSource).not.toContain('__royalVirtualTextureProbe');
    expect(combinedSource).not.toContain('terrain');
  });

  it('documents the VT route as a public descriptor preview until the renderer lowers it', async () => {
    const { combinedSource, textureSource } = await readVirtualTexturingSourceParts();

    expect(textureSource).toContain('TODO(public-vt-descriptor)');
    expect(textureSource).toContain('virtualTextureAsset({');
    expect(textureSource).toContain('preview: textureAsset({');
    expect(textureSource).toContain('textureAsset({');
    expect(textureSource).toContain('until the renderer lowers');
    expect(combinedSource).not.toMatch(/\bvirtualTexture\s*\(/);
    expect(combinedSource).not.toMatch(
      /\b(?:createVirtualTextureResource|VirtualTextureResource|VirtualTexturePageSource)\b/,
    );
    expect(combinedSource).not.toContain('@royal/renderer-webgl/virtual-texturing');
  });

  it('keeps VT testing imports out of examples', () => {
    const vtTestingImporters = examples.filter((example) =>
      example.source.includes('@royal/renderer-webgl/virtual-texturing/testing'),
    );

    expect(vtTestingImporters).toEqual([]);
  });

  it('reserves product VT examples for public descriptor material lowering', async () => {
    const productVirtualTexturingExamples = examples.filter(
      (example) => isVirtualTexturingExample(example) && example.maturity === 'product',
    );
    const { combinedSource } = await readVirtualTexturingSourceParts();

    expect(productVirtualTexturingExamples.map((example) => example.id)).toEqual([
      'virtual-texturing',
    ]);

    for (const example of productVirtualTexturingExamples) {
      const source = example.id === 'virtual-texturing' ? combinedSource : example.source;

      expect(source).toContain('@royal/renderer-core');
      expect(source).toContain('@royal/react');
      expect(source).not.toMatch(/@royal\/renderer-webgl(?:\/[^'"\s]*)?/);
      expect(source).not.toMatch(
        /@royal\/renderer-webgl\/virtual-texturing(?:\/testing)?/,
      );
      expect(source).not.toMatch(
        /\b(?:WebGLTexture|texSubImage2D|VirtualTextureRuntime|VirtualTexturePageAddress|VirtualTexturePageId|createVirtualTexturePageTableTexture|planVirtualTextureUploads|uploadVirtualTexturePageTableTexels|virtualTexturePageId)\b/,
      );
      expect(source).not.toMatch(/\bcreateVirtualTexturePageTableTexture\b/);
      expect(source).not.toMatch(/\buploadVirtualTexturePageTableTexels\b/);
      expect(source).not.toMatch(/\bpage[-Tt]able\b|\bruntime\b|\btesting\b/);
      expect(source).toMatch(/\b(?:standardMaterial|unlitMaterial)\s*\(/);
      expect(source).toMatch(/\bmesh\b/);
    }
  });
});
