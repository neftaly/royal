/** @jsxImportSource @royal/react */
import {
  createTextFontFace,
  type RenderNode,
  type RenderRoot,
  type Rgba,
  type TextFontFace,
  type Vec3,
} from '@royal/renderer-core';
import { Canvas } from '@royal/react';
import { createElement, useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import fontUrl from '../../assets/atkinson-hyperlegible-latin-400-normal.woff?url';

const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;
const headingSampleText = 'Voilà, naïve façade: “Royal” — type in motion';
const defaultSampleText = 'Moloch, whose factories dream and croak in the fog';
const defaultFontSize = 0.9;

type CanvasTextBox = {
  readonly height: number;
  readonly render: (origin: Vec3) => readonly RenderNode[];
  readonly width: number;
};

type TextBoxOptions = {
  readonly color: Rgba;
  readonly font: TextFontFace;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly text: string;
  readonly width: number;
};

type StackOptions = {
  readonly children: readonly CanvasTextBox[];
  readonly gap: number;
  readonly origin: Vec3;
};

const linesIn = (text: string): number => text.split('\n').length;

const wrapCanvasLine = (text: string, limit: number): string => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const next = line === '' ? word : `${line} ${word}`;
    if (next.length > limit && line !== '') {
      lines.push(line);
      line = word;
      continue;
    }
    line = next;
  }

  if (line !== '') lines.push(line);
  return lines.join('\n');
};

const textBox = ({ color, font, fontSize, lineHeight, text, width }: TextBoxOptions): CanvasTextBox => ({
  height: Math.max(1, linesIn(text)) * lineHeight,
  render: (origin) => [
    (
      <text
        color={color}
        font={font}
        fontSize={fontSize}
        lineHeight={lineHeight}
        origin={origin}
        text={text}
      />
    ) as RenderNode,
  ],
  width,
});

const h1 = (font: TextFontFace, text: string): CanvasTextBox =>
  textBox({
    color: [0.98, 0.94, 0.55, 1],
    font,
    fontSize: 0.88,
    lineHeight: 1.02,
    text,
    width: 5.3,
  });

const h2 = (font: TextFontFace, text: string): CanvasTextBox =>
  textBox({
    color: [0.52, 0.9, 0.84, 1],
    font,
    fontSize: 0.32,
    lineHeight: 0.43,
    text,
    width: 3.25,
  });

const editableSentence = (
  font: TextFontFace,
  text: string,
  fontSize: number,
): CanvasTextBox => {
  const wrappedText = wrapCanvasLine(text, Math.max(18, Math.round(34 / fontSize)));
  return textBox({
    color: [0.28, 0.95, 0.48, 1],
    font,
    fontSize,
    lineHeight: fontSize * 1.2,
    text: wrappedText,
    width: 8.9,
  });
};

const row = ({ children, gap }: Omit<StackOptions, 'origin'>): CanvasTextBox => ({
  height: Math.max(...children.map((child) => child.height)),
  render: (origin) => {
    let cursorX = origin[0];
    return children.flatMap((child) => {
      const nodes = child.render([cursorX, origin[1], origin[2]]);
      cursorX += child.width + gap;
      return nodes;
    });
  },
  width: children.reduce((width, child) => width + child.width, 0) + gap * Math.max(0, children.length - 1),
});

const column = ({ children, gap, origin }: StackOptions): readonly RenderNode[] => {
  let cursorY = origin[1];
  return children.flatMap((child) => {
    const nodes = child.render([origin[0], cursorY, origin[2]]);
    cursorY -= child.height + gap;
    return nodes;
  });
};

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

const textScene = (font: TextFontFace, sampleText: string, fontSize: number): RenderRoot =>
  (
    <scene>
      <pass clearColor={[0.025, 0.032, 0.038, 1]}>
        <orthographicCamera
          bottom={-3.2}
          far={100}
          left={-5.6}
          near={0.1}
          position={[0, 0, 10]}
          right={5.6}
          rotation={[0, 0, 0]}
          top={3.2}
        />
        {column({
          children: [
            h1(font, headingSampleText),
            h2(font, 'h1 / h2 canvas primitives'),
            editableSentence(font, sampleText, fontSize),
            row({
              children: [
                h2(font, 'column rhythm'),
                h2(font, 'row spacing'),
              ],
              gap: 0.42,
            }),
          ],
          gap: 0.2,
          origin: [-4.7, 2.15, 0],
        })}
      </pass>
    </scene>
  ) as RenderRoot;

export const RendererText = (): ReactNode => {
  const font = useAtkinsonFont();
  const [sampleText, setSampleText] = useState(defaultSampleText);
  const [fontSize, setFontSize] = useState(defaultFontSize);
  const scene = font === undefined ? textScenePlaceholder : textScene(font, sampleText, fontSize);

  const handleSampleTextChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setSampleText(event.currentTarget.value);
  };

  const handleFontSizeChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setFontSize(Number(event.currentTarget.value));
  };

  return createElement(
    'div',
    { className: 'text-example' },
    createElement(
      'div',
      { className: 'text-example-controls' },
      createElement(
        'label',
        { className: 'text-example-field' },
        createElement('span', null, 'Editable sentence'),
        createElement('input', {
          onChange: handleSampleTextChange,
          type: 'text',
          value: sampleText,
        }),
      ),
      createElement(
        'label',
        { className: 'text-example-field text-example-size-field' },
        createElement('span', null, `Font size ${fontSize.toFixed(2)}`),
        createElement('input', {
          max: 1.2,
          min: 0.68,
          onChange: handleFontSizeChange,
          step: 0.04,
          type: 'range',
          value: fontSize,
        }),
      ),
    ),
    createElement(Canvas, {
      'aria-label': 'Renderer text',
      children: scene,
      rootOptions,
    }),
  );
};

const textScenePlaceholder = (
  <scene>
    <pass clearColor={[0.025, 0.032, 0.038, 1]}>
      <orthographicCamera
        bottom={-3.2}
        far={100}
        left={-5.6}
        near={0.1}
        position={[0, 0, 10]}
        right={5.6}
        rotation={[0, 0, 0]}
        top={3.2}
      />
    </pass>
  </scene>
) as RenderRoot;
