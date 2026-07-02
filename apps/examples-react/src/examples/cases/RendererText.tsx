/** @jsxImportSource @royal/react */
import { TextSurface } from '@royal/react';
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
  rows * textStyle.lineHeight + textStyle.fieldPaddingY * 2;

type TextExampleLayout = {
  readonly copy: {
    readonly maxWidth: number;
    readonly origin: readonly [number, number, number];
  };
  readonly notes: {
    readonly maxWidth: number;
    readonly origin: readonly [number, number, number];
  };
  readonly title: {
    readonly maxWidth: number;
    readonly origin: readonly [number, number, number];
  };
};

type TextExampleLayoutKey = 'copy' | 'notes' | 'title';

const layoutMaxWidth = (box: FlexLayoutBox): number =>
  box.width - textStyle.fieldPaddingX * 2;

const textOriginX = (box: FlexLayoutBox): number =>
  bounds.left + box.left + textStyle.fieldPaddingX;

const fieldOrigin = (box: FlexLayoutBox): readonly [number, number, number] => [
  textOriginX(box),
  bounds.top - box.top - textStyle.lineHeight / 2,
  0,
];

const copyOrigin = (box: FlexLayoutBox): readonly [number, number, number] => [
  textOriginX(box),
  bounds.top - box.top - textStyle.lineHeight * 0.64,
  0,
];

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
    copy: {
      maxWidth: layoutMaxWidth(boxes.copy),
      origin: copyOrigin(boxes.copy),
    },
    notes: {
      maxWidth: layoutMaxWidth(boxes.notes),
      origin: fieldOrigin(boxes.notes),
    },
    title: {
      maxWidth: layoutMaxWidth(boxes.title),
      origin: fieldOrigin(boxes.title),
    },
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
            copyable
            font={font}
            maxWidth={textExampleLayout.copy.maxWidth}
            origin={textExampleLayout.copy.origin}
            selectable
          >
            Select and copy this renderer text.
          </text>
          <input
            font={font}
            maxWidth={textExampleLayout.title.maxWidth}
            onValueChange={setTitle}
            origin={textExampleLayout.title.origin}
            placeholder="Title"
            value={title}
          />
          <textarea
            font={font}
            maxWidth={textExampleLayout.notes.maxWidth}
            onValueChange={setNotes}
            origin={textExampleLayout.notes.origin}
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
