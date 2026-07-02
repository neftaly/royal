/** @jsxImportSource @royal/react */
import { type TextFontFace } from '@royal/renderer-core/text/font';
import { TextSurface, textFieldHeight } from '@royal/react';
import { useMemo, useState, type ReactNode } from 'react';
import { htmlColor } from '../color';
import { useAtkinsonFont } from './text-font';

const viewport = {
  bottom: -3.2,
  left: -5.6,
  right: 5.6,
  top: 3.2,
} as const;

const rows = 3;
const fieldStyle = {
  fieldPaddingY: 0.12,
  lineHeight: 0.36,
} as const;
const fieldHeight = textFieldHeight({
  lineHeight: fieldStyle.lineHeight,
  paddingY: fieldStyle.fieldPaddingY,
  rows,
});

const lorem =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus posuere velit aliquet.';
const textareaLorem = 'Lorem ipsum dolor sit amet.\nConsectetur adipiscing elit.\nInteger posuere erat a ante.';

const FieldLabel = ({
  children,
  color,
  font,
  left,
  top,
}: {
  readonly children: string;
  readonly color: string;
  readonly font: TextFontFace;
  readonly left: number;
  readonly top: number;
}): ReactNode => (
  <text
    box={{ left, top, width: 4.6 }}
    color={htmlColor(color)}
    font={font}
    fontSize={0.2}
    lineHeight={0.26}
  >
    {children}
  </text>
);

const FormControlsScene = ({
  font,
}: {
  readonly font: TextFontFace;
}): ReactNode => {
  const [title, setTitle] = useState('Lorem ipsum dolor');
  const [emptyText, setEmptyText] = useState('');
  const [notes, setNotes] = useState(textareaLorem);
  const [checked, setChecked] = useState(true);
  const [color, setColor] = useState('#55e08a');
  const [files, setFiles] = useState<readonly File[]>([]);
  const [presses, setPresses] = useState(0);
  const summary = useMemo(
    () => [
      `Text: ${title}`,
      `Placeholder: ${emptyText || '(empty)'}`,
      `Checkbox: ${checked ? 'checked' : 'unchecked'} | Presses: ${presses}`,
      `Files: ${files.length === 0 ? 'none' : files.map((file) => file.name).join(', ')}`,
      `Color: ${color}`,
      `Textarea: ${notes.replace(/\n/g, ' / ')}`,
    ].join('\n'),
    [checked, color, emptyText, files, notes, presses, title],
  );

  return (
    <TextSurface
      aria-label="Controlled form controls"
      style={{ cursor: 'text', touchAction: 'none' }}
      styleOptions={{
        color: htmlColor('#edf7f8'),
        fieldColor: htmlColor('#10171a'),
        fieldPaddingX: 0.16,
        fieldPaddingY: fieldStyle.fieldPaddingY,
        fontSize: 0.27,
        lineHeight: fieldStyle.lineHeight,
        placeholderColor: htmlColor('#6f7f83'),
        selectionColor: htmlColor('#1d607f'),
      }}
    >
      <scene>
        <pass clearColor={htmlColor('#080b0d')}>
          <orthographicCamera {...viewport} />

          <FieldLabel color="#55e08a" font={font} left={-4.95} top={0.35}>
            Selectable non-editable text
          </FieldLabel>
          <text
            box={{ left: -4.95, top: 0.68, width: 4.35 }}
            color={htmlColor('#dff7e8')}
            copyable
            font={font}
            selectable
          >
            {lorem}
          </text>

          <FieldLabel color="#8fc7ff" font={font} left={0.65} top={0.35}>
            Input type = text
          </FieldLabel>
          <input
            box={{ left: 0.65, top: 0.68, width: 4.35 }}
            font={font}
            onValueChange={setTitle}
            placeholder="Lorem ipsum"
            value={title}
          />

          <FieldLabel color="#b8a7ff" font={font} left={-4.95} top={1.72}>
            Empty placeholder input
          </FieldLabel>
          <input
            box={{ left: -4.95, top: 2.05, width: 4.35 }}
            font={font}
            onValueChange={setEmptyText}
            placeholder="Type into this controlled field"
            value={emptyText}
          />

          <FieldLabel color="#ffd166" font={font} left={0.65} top={1.72}>
            multiline textarea
          </FieldLabel>
          <textarea
            box={{ height: fieldHeight, left: 0.65, top: 2.05, width: 4.35 }}
            font={font}
            onValueChange={setNotes}
            placeholder="Lorem ipsum"
            rows={rows}
            value={notes}
          />

          <FieldLabel color="#f2a0a0" font={font} left={-4.95} top={3.62}>
            Controlled action inputs
          </FieldLabel>
          <input
            box={{ height: 0.5, left: -4.95, top: 3.95, width: 4.35 }}
            checked={checked}
            font={font}
            onCheckedChange={setChecked}
            type="checkbox"
          >
            Send me updates
          </input>
          <button
            box={{ height: 0.5, left: 0.65, top: 3.95, width: 1.25 }}
            font={font}
            onPress={() => setPresses((count) => count + 1)}
            type="button"
          >
            Press
          </button>
          <input
            box={{ height: 0.5, left: 2.06, top: 3.95, width: 1.28 }}
            font={font}
            multiple
            onFilesChange={setFiles}
            type="file"
          >
            File
          </input>
          <input
            box={{ height: 0.5, left: 3.5, top: 3.95, width: 1.5 }}
            font={font}
            onValueChange={setColor}
            type="color"
            value={color}
          >
            Color
          </input>

          <FieldLabel color="#7ee0d1" font={font} left={-4.95} top={4.68}>
            React state preview
          </FieldLabel>
          <text
            box={{ left: -4.95, top: 4.98, width: 9.95 }}
            color={htmlColor('#cfe5e7')}
            copyable
            font={font}
            fontSize={0.18}
            lineHeight={0.23}
            selectable
          >
            {summary}
          </text>
        </pass>
      </scene>
    </TextSurface>
  );
};

export const FormControls = (): ReactNode => {
  const fontState = useAtkinsonFont();

  if (fontState.status !== 'ready') return null;

  return <FormControlsScene font={fontState.font} />;
};
