/** @jsxImportSource @royal/react */
import { TextSurface } from '@royal/react';
import { type TextFontFace } from '@royal/renderer-core/text/font';
import { useState, type ReactNode } from 'react';
import { useAtkinsonFont } from './text-font';

const bounds = {
  bottom: -3.2,
  left: -5.6,
  right: 5.6,
  top: 3.2,
} as const;

const renderer = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const TextPrimitivesExample = ({
  font,
}: {
  readonly font: TextFontFace;
}): ReactNode => {
  const [title, setTitle] = useState('Royal text primitives');
  const [notes, setNotes] = useState('Selectable text, input, and textarea share the same canvas focus, selection, clipboard, and context-menu primitives.');

  return (
    <TextSurface
      aria-label="Text primitives"
      bounds={bounds}
      renderer={renderer}
      style={{ cursor: 'text', touchAction: 'none' }}
      styleOptions={{
        color: [0.86, 0.94, 0.98, 1],
        fieldColor: [0.055, 0.07, 0.08, 0.96],
        fontSize: 0.32,
        lineHeight: 0.42,
        selectionColor: [0.08, 0.31, 0.48, 1],
      }}
    >
      <scene>
        <pass clearColor={[0.025, 0.032, 0.038, 1]}>
          <orthographicCamera
            bottom={bounds.bottom}
            far={100}
            left={bounds.left}
            near={0.1}
            position={[0, 0, 10]}
            right={bounds.right}
            rotation={[0, 0, 0]}
            top={bounds.top}
          />
          <text
            color={[0.35, 0.95, 0.56, 1]}
            copyable
            font={font}
            maxWidth={7.6}
            origin={[-4.72, 1.55, 0]}
            selectable
          >
            Select and copy this renderer text.
          </text>
          <input
            font={font}
            maxWidth={7.6}
            onValueChange={setTitle}
            origin={[-4.72, 0.55, 0]}
            placeholder="Title"
            value={title}
          />
          <textarea
            font={font}
            maxWidth={7.6}
            onValueChange={setNotes}
            origin={[-4.72, -0.35, 0]}
            placeholder="Notes"
            rows={4}
            value={notes}
          />
        </pass>
      </scene>
    </TextSurface>
  );
};

export const RendererText = (): ReactNode => {
  const fontState = useAtkinsonFont();

  if (fontState.status !== 'ready') return null;

  return <TextPrimitivesExample font={fontState.font} />;
};
