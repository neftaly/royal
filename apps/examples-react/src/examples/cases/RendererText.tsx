/** @jsxImportSource @royal/react */
import { TextSurface } from '@royal/react';
import { type TextFontFace } from '@royal/renderer-core/text/font';
import { useState, type ReactNode } from 'react';
import { htmlColor } from '../color';
import { useAtkinsonFont } from './text-font';

const bounds = {
  bottom: -3.2,
  left: -5.6,
  right: 5.6,
  top: 3.2,
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
      style={{ cursor: 'text', touchAction: 'none' }}
      styleOptions={{
        color: htmlColor('#dbf0fa'),
        fieldColor: htmlColor('rgba(14, 18, 20, 0.96)'),
        fontSize: 0.32,
        lineHeight: 0.42,
        selectionColor: htmlColor('#144f7a'),
      }}
    >
      <scene>
        <pass clearColor={htmlColor('#06080a')}>
          <orthographicCamera {...bounds} />
          <text
            color={htmlColor('#59f28f')}
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
