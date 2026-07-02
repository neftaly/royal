/** @jsxImportSource @royal/react */
import { TextSurface } from '@royal/react';
import { type TextFontFace } from '@royal/renderer-core/text/font';
import {
  ALIGN_FLEX_START,
  DIRECTION_LTR,
  EDGE_BOTTOM,
  EDGE_LEFT,
  EDGE_TOP,
  FLEX_DIRECTION_COLUMN,
  GUTTER_ALL,
  Node,
} from 'flexily';
import { useState, type ReactNode } from 'react';
import { htmlColor } from '../color';
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

type LayoutBox = {
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
};

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

const layoutBox = (node: Node): LayoutBox => ({
  height: node.getComputedHeight(),
  left: node.getComputedLeft(),
  top: node.getComputedTop(),
  width: node.getComputedWidth(),
});

const layoutMaxWidth = (box: LayoutBox): number =>
  box.width - textStyle.fieldPaddingX * 2;

const textOriginX = (box: LayoutBox): number =>
  bounds.left + box.left + textStyle.fieldPaddingX;

const fieldOrigin = (box: LayoutBox): readonly [number, number, number] => [
  textOriginX(box),
  bounds.top - box.top - textStyle.lineHeight / 2,
  0,
];

const copyOrigin = (box: LayoutBox): readonly [number, number, number] => [
  textOriginX(box),
  bounds.top - box.top - textStyle.lineHeight * 0.64,
  0,
];

const createTextExampleLayout = (): TextExampleLayout => {
  const root = Node.create({ defaults: 'css' });
  const copy = Node.create({ defaults: 'css' });
  const title = Node.create({ defaults: 'css' });
  const notes = Node.create({ defaults: 'css' });
  const width = bounds.right - bounds.left;
  const height = bounds.top - bounds.bottom;

  try {
    root.setWidth(width);
    root.setHeight(height);
    root.setFlexDirection(FLEX_DIRECTION_COLUMN);
    root.setAlignItems(ALIGN_FLEX_START);
    root.setPadding(EDGE_LEFT, 0.74);
    root.setPadding(EDGE_TOP, 1.38);
    root.setGap(GUTTER_ALL, 0.26);

    copy.setWidth(textColumnBoxWidth);
    copy.setHeight(textStyle.lineHeight);
    copy.setMargin(EDGE_BOTTOM, 0.38);

    title.setWidth(textColumnBoxWidth);
    title.setHeight(fieldHeight(titleRows));

    notes.setWidth(textColumnBoxWidth);
    notes.setHeight(fieldHeight(notesRows));

    root.insertChild(copy, 0);
    root.insertChild(title, 1);
    root.insertChild(notes, 2);
    root.calculateLayout(width, height, DIRECTION_LTR);

    const copyBox = layoutBox(copy);
    const titleBox = layoutBox(title);
    const notesBox = layoutBox(notes);

    return {
      copy: {
        maxWidth: layoutMaxWidth(copyBox),
        origin: copyOrigin(copyBox),
      },
      notes: {
        maxWidth: layoutMaxWidth(notesBox),
        origin: fieldOrigin(notesBox),
      },
      title: {
        maxWidth: layoutMaxWidth(titleBox),
        origin: fieldOrigin(titleBox),
      },
    };
  } finally {
    root.freeRecursive();
  }
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
