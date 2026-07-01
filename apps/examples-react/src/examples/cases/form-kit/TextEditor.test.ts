import { describe, expect, it } from 'vitest';
import {
  readRoyalTextEditorNativePasteText,
  resolveRoyalTextEditorMenuPaste,
} from './TextEditor';

describe('RoyalTextEditor primitive', () => {
  it('reads text from a native paste event payload', () => {
    const clipboardData = {
      getData: (type: string) => type === 'text/plain' ? 'native paste text' : '',
    };

    expect(readRoyalTextEditorNativePasteText(clipboardData)).toEqual({
      ok: true,
      text: 'native paste text',
    });
  });

  it('reports empty native paste event payloads without a custom fallback', () => {
    const clipboardData = {
      getData: () => '',
    };

    expect(readRoyalTextEditorNativePasteText(clipboardData)).toEqual({
      message: 'Clipboard event text was empty',
      ok: false,
      reason: 'empty-paste',
    });
  });

  it('resolves denied context-menu reads as failures instead of custom paste fallback', () => {
    expect(resolveRoyalTextEditorMenuPaste({
      message: 'Read permission denied',
      ok: false,
      reason: 'denied',
    })).toEqual({
      message: 'Read permission denied',
      reason: 'denied',
      type: 'failure',
    });
  });

  it('resolves successful context-menu reads as text insertion', () => {
    expect(resolveRoyalTextEditorMenuPaste({
      ok: true,
      text: 'menu paste text',
    })).toEqual({
      text: 'menu paste text',
      type: 'insert',
    });
  });
});
