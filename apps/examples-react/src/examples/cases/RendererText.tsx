import { type ReactNode } from 'react';
import { RoyalTextEditor } from './form-kit/TextEditor';
import { useAtkinsonFont } from './text-font';

export const RendererText = (): ReactNode => {
  const fontState = useAtkinsonFont();

  if (fontState.status !== 'ready') return null;

  return (
    <RoyalTextEditor
      description="Caret placement, drag selection, native paste, and canvas context menu"
      font={fontState.font}
      initialText="Click to place the caret. Drag to select text. Use Ctrl-C, Ctrl-X, and Ctrl-V."
      title="Editable renderer text"
    />
  );
};
