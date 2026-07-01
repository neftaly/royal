import { createTextFontFace, type TextFontFace } from '@royal/renderer-core/text';
import { useEffect, useState } from 'react';
import fontUrl from '../../assets/atkinson-hyperlegible-latin-400-normal.woff?url';

export type ExampleTextFontState =
  | { readonly status: 'loading' }
  | { readonly font: TextFontFace; readonly status: 'ready' }
  | { readonly status: 'failed' };

export const useAtkinsonFont = (): ExampleTextFontState => {
  const [state, setState] = useState<ExampleTextFontState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const response = await fetch(fontUrl);
        if (!response.ok) throw new Error(`Font request failed: ${response.status}`);
        const data = await response.arrayBuffer();
        const face = createTextFontFace({
          data,
          family: 'Atkinson Hyperlegible',
          source: fontUrl,
        });
        if (!cancelled) setState({ font: face, status: 'ready' });
      } catch {
        if (!cancelled) setState({ status: 'failed' });
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
};
