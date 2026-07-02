/** @jsxImportSource @royal/react */
import { type TextFontFace } from '@royal/renderer-core/text/font';
import { TextFontProvider, TextInteractionProvider, TextSurface } from '@royal/react';
import { useMemo, useState, type ReactNode } from 'react';
import { htmlColor } from '../color';
import { layoutFlexTree, type FlexLayoutBox } from '../flex-layout';
import { exampleRenderer } from '../rendering';
import { useAtkinsonFont } from './text-font';

const surfaceBounds = {
  bottom: -3.2,
  left: -5.6,
  right: 5.6,
  top: 3.2,
} as const;

const surfaceSize = {
  height: surfaceBounds.top - surfaceBounds.bottom,
  width: surfaceBounds.right - surfaceBounds.left,
} as const;

const rows = 3;
const fieldStyle = {
  fieldPaddingY: 0.12,
  lineHeight: 0.36,
} as const;
const fieldHeight = fieldStyle.lineHeight + fieldStyle.fieldPaddingY * 2;
const textareaHeight = rows * fieldStyle.lineHeight + fieldStyle.fieldPaddingY * 2;

type FormBoxId =
  | 'actionLabel'
  | 'button'
  | 'checkbox'
  | 'color'
  | 'emptyInput'
  | 'emptyLabel'
  | 'file'
  | 'notes'
  | 'notesLabel'
  | 'preview'
  | 'previewLabel'
  | 'readText'
  | 'readTextLabel'
  | 'title'
  | 'titleLabel';

const boxes = layoutFlexTree<FormBoxId>({
  direction: 'column',
  gap: 0.18,
  height: surfaceSize.height,
  padding: {
    bottom: 0.25,
    horizontal: 0.65,
    top: 0.25,
  },
  width: surfaceSize.width,
  children: [
    {
      direction: 'row',
      gap: 0.65,
      height: 1.08,
      itemWidth: 4.63,
      children: [
        {
          direction: 'column',
          gap: 0.1,
          children: [
            { height: 0.26, id: 'readTextLabel' },
            { height: 0.72, id: 'readText' },
          ],
        },
        {
          direction: 'column',
          gap: 0.1,
          children: [
            { height: 0.26, id: 'titleLabel' },
            { height: fieldHeight, id: 'title' },
          ],
        },
      ],
    },
    {
      direction: 'row',
      gap: 0.65,
      height: 1.68,
      itemWidth: 4.63,
      children: [
        {
          direction: 'column',
          gap: 0.1,
          children: [
            { height: 0.26, id: 'emptyLabel' },
            { height: fieldHeight, id: 'emptyInput' },
          ],
        },
        {
          direction: 'column',
          gap: 0.1,
          children: [
            { height: 0.26, id: 'notesLabel' },
            { height: textareaHeight, id: 'notes' },
          ],
        },
      ],
    },
    {
      direction: 'column',
      gap: 0.1,
      height: 0.86,
      children: [
        { height: 0.24, id: 'actionLabel' },
        {
          direction: 'row',
          gap: 0.18,
          height: 0.5,
          children: [
            { id: 'checkbox', width: 4.3 },
            { id: 'button', width: 1.25 },
            { id: 'file', width: 1.28 },
            { id: 'color', width: 1.5 },
          ],
        },
      ],
    },
    {
      direction: 'column',
      gap: 0.1,
      height: 1.7,
      children: [
        { height: 0.24, id: 'previewLabel' },
        { height: 1.36, id: 'preview' },
      ],
    },
  ],
});

const lorem =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus posuere velit aliquet.';
const textareaLorem = 'Lorem ipsum dolor sit amet.\nConsectetur adipiscing elit.\nInteger posuere erat a ante.';

const FieldLabel = ({
  box,
  children,
  color,
}: {
  readonly box: FlexLayoutBox;
  readonly children: string;
  readonly color: string;
}): ReactNode => (
  <text
    box={box}
    color={htmlColor(color)}
    style={{
      fontSize: 0.2,
      lineHeight: 0.26,
    }}
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
    <TextInteractionProvider>
      <TextFontProvider font={font}>
        <TextSurface
          aria-label="Controlled form controls"
          bounds={surfaceBounds}
          renderer={exampleRenderer}
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
              <orthographicCamera {...surfaceBounds} />

              <FieldLabel box={boxes.readTextLabel} color="#55e08a">
                Selectable non-editable text
              </FieldLabel>
              <text
                box={boxes.readText}
                color={htmlColor('#dff7e8')}
                copyable
                selectable
              >
                {lorem}
              </text>

              <FieldLabel box={boxes.titleLabel} color="#8fc7ff">
                Input type = text
              </FieldLabel>
              <input
                box={boxes.title}
                onValueChange={setTitle}
                placeholder="Lorem ipsum"
                value={title}
              />

              <FieldLabel box={boxes.emptyLabel} color="#b8a7ff">
                Empty placeholder input
              </FieldLabel>
              <input
                box={boxes.emptyInput}
                onValueChange={setEmptyText}
                placeholder="Type into this controlled field"
                value={emptyText}
              />

              <FieldLabel box={boxes.notesLabel} color="#ffd166">
                multiline textarea
              </FieldLabel>
              <textarea
                box={boxes.notes}
                onValueChange={setNotes}
                placeholder="Lorem ipsum"
                rows={rows}
                value={notes}
              />

              <FieldLabel box={boxes.actionLabel} color="#f2a0a0">
                Controlled action inputs
              </FieldLabel>
              <input
                box={boxes.checkbox}
                checked={checked}
                onCheckedChange={setChecked}
                type="checkbox"
              >
                Send me updates
              </input>
              <button
                box={boxes.button}
                onPress={() => setPresses((count) => count + 1)}
                type="button"
              >
                Press
              </button>
              <input
                box={boxes.file}
                multiple
                onFilesChange={setFiles}
                type="file"
              >
                File
              </input>
              <input
                box={boxes.color}
                onValueChange={setColor}
                type="color"
                value={color}
              >
                Color
              </input>

              <FieldLabel box={boxes.previewLabel} color="#7ee0d1">
                React state preview
              </FieldLabel>
              <text
                box={boxes.preview}
                color={htmlColor('#cfe5e7')}
                copyable
                fontSize={0.18}
                lineHeight={0.23}
                selectable
              >
                {summary}
              </text>
            </pass>
          </scene>
        </TextSurface>
      </TextFontProvider>
    </TextInteractionProvider>
  );
};

export const FormControls = (): ReactNode => {
  const fontState = useAtkinsonFont();

  if (fontState.status !== 'ready') return null;

  return <FormControlsScene font={fontState.font} />;
};
