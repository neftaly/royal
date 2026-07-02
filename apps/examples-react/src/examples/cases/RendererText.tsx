/** @jsxImportSource @royal/react */
import { TextFontProvider, TextInteractionProvider, TextSurface } from '@royal/react';
import { type TextFontFace } from '@royal/renderer-core/text/font';
import { useState, type ReactNode } from 'react';
import { htmlColor } from '../color';
import { exampleRenderer } from '../rendering';
import { useAtkinsonFont } from './text-font';

const viewport = {
  bottom: -3.2,
  left: -5.6,
  right: 5.6,
  top: 3.2,
} as const;

const inputLorem = 'Lorem ipsum dolor sit amet';
const loremIpsum = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus posuere velit aliquet.';
const textareaLorem = 'Lorem ipsum dolor sit amet.\nConsectetur adipiscing elit.\nInteger posuere erat a ante.';
const textareaRows = 4;
const textStyle = {
  fieldPaddingY: 0.12,
  lineHeight: 0.38,
};

const styles = {
  label: {
    fontSize: 0.22,
    lineHeight: 0.28,
  },
  input: {
    left: 1.2,
    top: 2.28,
    width: 8.8,
  },
  inputLabel: {
    left: 1.2,
    top: 1.88,
    width: 8.8,
  },
  selectableLabel: {
    left: 1.2,
    top: 0.72,
    width: 8.8,
  },
  selectableText: {
    left: 1.2,
    top: 1.12,
    width: 8.8,
  },
  textarea: {
    height: textareaRows * textStyle.lineHeight + textStyle.fieldPaddingY * 2,
    left: 1.2,
    top: 3.48,
    width: 8.8,
  },
  textareaLabel: {
    left: 1.2,
    top: 3.08,
    width: 8.8,
  },
} as const;

const TextPrimitivesExample = ({
  font,
}: {
  readonly font: TextFontFace;
}): ReactNode => {
  const [title, setTitle] = useState(inputLorem);
  const [notes, setNotes] = useState(textareaLorem);

  return (
    <TextInteractionProvider>
      <TextFontProvider font={font}>
        <TextSurface
          aria-label="Text primitives"
          renderer={exampleRenderer}
          style={{ cursor: 'text', touchAction: 'none' }}
          styleOptions={{
            color: htmlColor('#e7f3f5'),
            fieldColor: htmlColor('#101619'),
            fieldPaddingX: 0.18,
            fieldPaddingY: textStyle.fieldPaddingY,
            fontSize: 0.28,
            lineHeight: textStyle.lineHeight,
            placeholderColor: htmlColor('#6d797c'),
            selectionColor: htmlColor('#1d5e86'),
          }}
        >
          <scene>
            <pass clearColor={htmlColor('#07090b')}>
              <orthographicCamera {...viewport} />
              <text
                box={styles.selectableLabel}
                color={htmlColor('#59f28f')}
                fontSize={styles.label.fontSize}
                lineHeight={styles.label.lineHeight}
              >
                Selectable non-editable text
              </text>
              <text
                box={styles.selectableText}
                color={htmlColor('#d8f6e4')}
                copyable
                selectable
              >
                {loremIpsum}
              </text>
              <text
                box={styles.inputLabel}
                color={htmlColor('#a9cfff')}
                fontSize={styles.label.fontSize}
                lineHeight={styles.label.lineHeight}
              >
                Input type = text
              </text>
              <input
                box={styles.input}
                onValueChange={setTitle}
                placeholder="Lorem ipsum"
                value={title}
              />
              <text
                box={styles.textareaLabel}
                color={htmlColor('#ffd77a')}
                fontSize={styles.label.fontSize}
                lineHeight={styles.label.lineHeight}
              >
                multiline textarea
              </text>
              <textarea
                box={styles.textarea}
                onValueChange={setNotes}
                placeholder="Lorem ipsum"
                rows={textareaRows}
                value={notes}
              />
            </pass>
          </scene>
        </TextSurface>
      </TextFontProvider>
    </TextInteractionProvider>
  );
};

export const RendererText = (): ReactNode => {
  const fontState = useAtkinsonFont();

  if (fontState.status !== 'ready') return null;

  return <TextPrimitivesExample font={fontState.font} />;
};
