/** @jsxImportSource @royal/react */
import { type TextFontFace } from '@royal/renderer-core/text/font';
import { TextFontProvider, TextInteractionProvider, TextSurface, textFieldHeight } from '@royal/react';
import { useMemo, useState, type ReactNode } from 'react';
import { htmlColor } from '../color';
import {
  flexColumn,
  flexItem,
  flexRow,
  flexStyle,
  layoutFlexTree,
  type FlexLayoutNode,
} from '../flex-layout';
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
const labelTextStyle = {
  fontSize: 0.2,
  lineHeight: 0.26,
} as const;
const fieldStyle = {
  fieldPaddingY: 0.12,
  lineHeight: 0.36,
} as const;
const fieldHeight = textFieldHeight({
  lineHeight: fieldStyle.lineHeight,
  paddingY: fieldStyle.fieldPaddingY,
});
const textareaHeight = textFieldHeight({
  lineHeight: fieldStyle.lineHeight,
  paddingY: fieldStyle.fieldPaddingY,
  rows,
});

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

const labeledField = (
  label: FormBoxId,
  control: FormBoxId,
  controlHeight: number,
): FlexLayoutNode<FormBoxId> => flexColumn([
  flexItem(label, { height: labelTextStyle.lineHeight }),
  flexItem(control, { height: controlHeight }),
], { gap: 0.1 });

const boxes = layoutFlexTree<FormBoxId>({
  ...flexColumn<FormBoxId>([
    flexRow([
      labeledField('readTextLabel', 'readText', 0.72),
      labeledField('titleLabel', 'title', fieldHeight),
    ], {
      gap: 0.65,
      height: 1.08,
      itemWidth: 4.63,
    }),
    flexRow([
      labeledField('emptyLabel', 'emptyInput', fieldHeight),
      labeledField('notesLabel', 'notes', textareaHeight),
    ], {
      gap: 0.65,
      height: 1.68,
      itemWidth: 4.63,
    }),
    flexColumn([
      flexItem('actionLabel', { height: 0.24 }),
      flexRow([
        flexItem('checkbox', { width: 4.3 }),
        flexItem('button', { width: 1.25 }),
        flexItem('file', { width: 1.28 }),
        flexItem('color', { width: 1.5 }),
      ], {
        gap: 0.18,
        height: 0.5,
      }),
    ], {
      gap: 0.1,
      height: 0.86,
    }),
    flexColumn([
      flexItem('previewLabel', { height: 0.24 }),
      flexItem('preview', { height: 1.36 }),
    ], {
      gap: 0.1,
      height: 1.7,
    }),
  ], {
    gap: 0.18,
    padding: {
      bottom: 0.25,
      horizontal: 0.65,
      top: 0.25,
    },
  }),
  height: surfaceSize.height,
  width: surfaceSize.width,
});

const lorem =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus posuere velit aliquet.';
const textareaLorem = 'Lorem ipsum dolor sit amet.\nConsectetur adipiscing elit.\nInteger posuere erat a ante.';

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

              <text color={htmlColor('#55e08a')} style={flexStyle(boxes.readTextLabel, labelTextStyle)}>
                Selectable non-editable text
              </text>
              <text
                color={htmlColor('#dff7e8')}
                copyable
                style={flexStyle(boxes.readText)}
              >
                {lorem}
              </text>

              <text color={htmlColor('#8fc7ff')} style={flexStyle(boxes.titleLabel, labelTextStyle)}>
                Input type = text
              </text>
              <input
                onValueChange={setTitle}
                placeholder="Lorem ipsum"
                style={flexStyle(boxes.title)}
                value={title}
              />

              <text color={htmlColor('#b8a7ff')} style={flexStyle(boxes.emptyLabel, labelTextStyle)}>
                Empty placeholder input
              </text>
              <input
                onValueChange={setEmptyText}
                placeholder="Type into this controlled field"
                style={flexStyle(boxes.emptyInput)}
                value={emptyText}
              />

              <text color={htmlColor('#ffd166')} style={flexStyle(boxes.notesLabel, labelTextStyle)}>
                multiline textarea
              </text>
              <textarea
                onValueChange={setNotes}
                placeholder="Lorem ipsum"
                rows={rows}
                style={flexStyle(boxes.notes)}
                value={notes}
              />

              <text color={htmlColor('#f2a0a0')} style={flexStyle(boxes.actionLabel, labelTextStyle)}>
                Controlled action inputs
              </text>
              <input
                checked={checked}
                onCheckedChange={setChecked}
                style={flexStyle(boxes.checkbox)}
                type="checkbox"
              >
                Send me updates
              </input>
              <button
                onPress={() => setPresses((count) => count + 1)}
                style={flexStyle(boxes.button)}
              >
                Press
              </button>
              <input
                multiple
                onFilesChange={setFiles}
                style={flexStyle(boxes.file)}
                type="file"
              >
                File
              </input>
              <input
                onValueChange={setColor}
                style={flexStyle(boxes.color)}
                type="color"
                value={color}
              >
                Color
              </input>

              <text color={htmlColor('#7ee0d1')} style={flexStyle(boxes.previewLabel, labelTextStyle)}>
                React state preview
              </text>
              <text
                color={htmlColor('#cfe5e7')}
                copyable
                style={flexStyle(boxes.preview, {
                  fontSize: 0.18,
                  lineHeight: 0.23,
                })}
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
