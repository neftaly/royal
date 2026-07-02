/** @jsxImportSource @royal/react */
import { TextSurface, textFieldHeight, type TextSurfaceBox } from '@royal/react';
import { type TextFontFace } from '@royal/renderer-core/text/font';
import { useState, type ReactNode } from 'react';
import { htmlColor } from '../color';
import { layoutFlexTree, type FlexLayoutBox } from '../flex-layout';
import { useAtkinsonFont } from './text-font';

const bounds = {
  bottom: -3.2,
  left: -5.6,
  right: 5.6,
  top: 3.2,
} as const;

const textStyle = {
  fieldPaddingX: 0.14,
  fieldPaddingY: 0.11,
  fontSize: 0.32,
  lineHeight: 0.42,
} as const;

const textColumnWidth = 7.6;
const textColumnBoxWidth = textColumnWidth + textStyle.fieldPaddingX * 2;
const titleRows = 1;
const notesRows = 4;

const fieldHeight = (rows: number): number =>
  textFieldHeight({
    lineHeight: textStyle.lineHeight,
    paddingY: textStyle.fieldPaddingY,
    rows,
  });

type TextExampleLayoutKey = 'copy' | 'notes' | 'title';
type TextExampleLayout = Record<TextExampleLayoutKey, TextSurfaceBox>;

const surfaceBox = (box: FlexLayoutBox): TextSurfaceBox => ({
  height: box.height,
  left: box.left,
  top: box.top,
  width: box.width,
});

const contentBox = (box: FlexLayoutBox): TextSurfaceBox => ({
  height: box.height,
  left: box.left + textStyle.fieldPaddingX,
  top: box.top,
  width: box.width - textStyle.fieldPaddingX * 2,
});

const createTextExampleLayout = (): TextExampleLayout => {
  const boxes = layoutFlexTree<TextExampleLayoutKey>({
    alignItems: 'flex-start',
    children: [
      {
        height: textStyle.lineHeight,
        id: 'copy',
        margin: { bottom: 0.38 },
      },
      {
        height: fieldHeight(titleRows),
        id: 'title',
      },
      {
        height: fieldHeight(notesRows),
        id: 'notes',
      },
    ],
    direction: 'column',
    gap: 0.26,
    height: bounds.top - bounds.bottom,
    itemWidth: textColumnBoxWidth,
    padding: { left: 0.74, top: 1.38 },
    width: bounds.right - bounds.left,
  });

  return {
    copy: contentBox(boxes.copy),
    notes: surfaceBox(boxes.notes),
    title: surfaceBox(boxes.title),
  };
};

const textExampleLayout = createTextExampleLayout();

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
        fieldColor: htmlColor('#0e1214'),
        fieldPaddingX: textStyle.fieldPaddingX,
        fieldPaddingY: textStyle.fieldPaddingY,
        fontSize: textStyle.fontSize,
        lineHeight: textStyle.lineHeight,
        selectionColor: htmlColor('#144f7a'),
      }}
    >
      <scene>
        <pass clearColor={htmlColor('#06080a')}>
          <orthographicCamera {...bounds} />
          <text
            color={htmlColor('#59f28f')}
            box={textExampleLayout.copy}
            copyable
            font={font}
            selectable
          >
            Select and copy this renderer text.
          </text>
          <input
            box={textExampleLayout.title}
            font={font}
            onValueChange={setTitle}
            placeholder="Title"
            value={title}
          />
          <textarea
            box={textExampleLayout.notes}
            font={font}
            onValueChange={setNotes}
            placeholder="Notes"
            rows={notesRows}
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
