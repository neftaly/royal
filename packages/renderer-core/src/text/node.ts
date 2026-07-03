import { layoutText } from './layout';
import type { TextNode, TextOptions } from './types';

export type { TextNode, TextOptions } from './types';

const createTextNode = (options: TextOptions): TextNode => {
  const layout = layoutText({
    ...(options.font === undefined ? {} : { font: options.font }),
    ...(options.fontSize === undefined ? {} : { fontSize: options.fontSize }),
    ...(options.lineHeight === undefined ? {} : { lineHeight: options.lineHeight }),
    ...(options.origin === undefined ? {} : { origin: options.origin }),
    text: options.text
  });

  return {
    kind: 'text',
    color: options.color,
    diagnostics: layout.diagnostics,
    layout
  };
};

export const text = (options: TextOptions): TextNode => createTextNode(options);
