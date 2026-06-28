import {
  Canvas,
} from '@royal/react';
import {
  boxGeometry,
  createTextFontFace,
  layoutText,
  mesh,
  orthographicCamera,
  pass,
  scene,
  text,
  textMesh,
  unlitMaterial,
  type RenderRoot,
  type TextFontFace,
} from '@royal/renderer-core';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

const panel = boxGeometry({ size: [1, 1, 0.08] });
const white = unlitMaterial({ color: [0.94, 0.96, 0.98, 1] });
const textFontSource =
  '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff';
const textFontUrl = new URL(
  '../../../node_modules/@royal/renderer-core/node_modules/@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff',
  import.meta.url,
).href;
let textFontFace: Promise<TextFontFace> | undefined;
const loadTextFontFace = (): Promise<TextFontFace> => {
  textFontFace ??= fetch(textFontUrl)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load ${textFontSource}: ${response.status}`);
      }
      return response.arrayBuffer();
    })
    .then((data) =>
      createTextFontFace({
        data,
        family: 'Atkinson Hyperlegible',
        source: textFontSource,
      }),
    );
  return textFontFace;
};
const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const textScene = (label: string, font: TextFontFace): RenderRoot =>
  scene({
    children: [
      pass({
        clearColor: [0.04, 0.05, 0.06, 1],
        camera: orthographicCamera({
          position: [0, 0, 8],
          rotation: [0, 0, 0],
          left: -5,
          right: 5,
          bottom: -2.8,
          top: 2.8,
          near: 0.1,
          far: 100,
        }),
        children: [
          text({
            color: [0.96, 0.96, 0.92, 1],
            font,
            fontSize: 0.72,
            lineHeight: 0.9,
            origin: [-3.9, 0.8, 0],
            text: label,
          }),
          text({
            color: [0.42, 0.72, 0.95, 1],
            font,
            fontSize: 0.36,
            lineHeight: 0.52,
            origin: [-3.9, -0.25, 0],
            text: 'vector text prototype',
          }),
          mesh({
            geometry: panel,
            material: white,
            transform: {
              position: [-3.0, -1.35, -0.1],
              rotation: [0, 0, 0],
              scale: [1.7, 0.05, 1],
            },
          }),
        ],
      }),
    ],
  });

export const TextPrototype = (): ReactNode => {
  const [label, setLabel] = useState('AV office 108%.');
  const [font, setFont] = useState<TextFontFace>();
  const [fontError, setFontError] = useState<Error>();

  useEffect(() => {
    let active = true;
    loadTextFontFace().then(
      (loadedFont) => {
        if (active) setFont(loadedFont);
      },
      (error: unknown) => {
        if (active) setFontError(error instanceof Error ? error : new Error(String(error)));
      },
    );

    return () => {
      active = false;
    };
  }, []);

  const metrics = useMemo(() => {
    if (font === undefined) return undefined;

    const layout = layoutText({ text: label, font, fontSize: 0.72, lineHeight: 0.9 });
    const meshData = textMesh(layout);
    return {
      glyphs: layout.lines[0]?.glyphs.length ?? 0,
      outlines: meshData.contours.length,
      vertices: meshData.vertices.length,
    };
  }, [font, label]);

  return (
    <div className="stacked-demo">
      <div className="canvas-slot">
        {font === undefined ? (
          <div className="canvas-placeholder" role={fontError === undefined ? 'status' : 'alert'}>
            {fontError === undefined ? 'Loading text font' : 'Text font failed to load'}
          </div>
        ) : (
          <Canvas aria-label="Vector text prototype" rootOptions={rootOptions}>
            {textScene(label, font)}
          </Canvas>
        )}
      </div>
      <div className="control-strip">
        <input
          aria-label="Text label"
          maxLength={22}
          value={label}
          onChange={(event) => setLabel(event.currentTarget.value)}
        />
        <span className="control-readout">
          {metrics === undefined
            ? 'loading real font'
            : `${metrics.glyphs} glyphs, ${metrics.outlines} outlines, ${metrics.vertices} vertices`}
        </span>
      </div>
    </div>
  );
};
