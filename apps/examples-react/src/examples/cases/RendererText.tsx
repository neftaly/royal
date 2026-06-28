/** @jsxImportSource @royal/react */
import {
  createTextFontFace,
  type RenderRoot,
  type TextFontFace,
} from '@royal/renderer-core';
import { Canvas } from '@royal/react';
import { createElement, useEffect, useState, type ReactNode } from 'react';
import fontUrl from '../../assets/atkinson-hyperlegible-latin-400-normal.woff?url';

const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const useAtkinsonFont = (): TextFontFace | undefined => {
  const [font, setFont] = useState<TextFontFace>();

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      const response = await fetch(fontUrl);
      if (!response.ok) throw new Error(`Font request failed: ${response.status}`);
      const data = await response.arrayBuffer();
      const face = createTextFontFace({
        data,
        family: 'Atkinson Hyperlegible',
        source: fontUrl,
      });
      if (!cancelled) setFont(face);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return font;
};

const textScene = (font: TextFontFace): RenderRoot =>
  (
    <scene>
      <pass clearColor={[0.025, 0.032, 0.038, 1]}>
        <orthographicCamera
          bottom={-3}
          far={100}
          left={-6}
          near={0.1}
          position={[0, 0, 10]}
          right={6}
          rotation={[0, 0, 0]}
          top={3}
        />
        <text
          color={[0.98, 0.92, 0.35, 1]}
          font={font}
          fontSize={1.15}
          lineHeight={1.35}
          origin={[-4.95, 0.78, 0]}
          text={'Royal text\nsharp curves'}
        />
        <text
          color={[0.42, 0.9, 0.82, 1]}
          font={font}
          fontSize={0.52}
          lineHeight={0.72}
          origin={[-4.88, -1.08, 0]}
          text="AV office type"
        />
      </pass>
    </scene>
  ) as RenderRoot;

export const RendererText = (): ReactNode => {
  const font = useAtkinsonFont();
  const scene = font === undefined ? textScenePlaceholder : textScene(font);

  return createElement(Canvas, {
    'aria-label': 'Renderer text',
    children: scene,
    rootOptions,
  });
};

const textScenePlaceholder = (
  <scene>
    <pass clearColor={[0.025, 0.032, 0.038, 1]}>
      <orthographicCamera
        bottom={-3}
        far={100}
        left={-6}
        near={0.1}
        position={[0, 0, 10]}
        right={6}
        rotation={[0, 0, 0]}
        top={3}
      />
    </pass>
  </scene>
) as RenderRoot;
