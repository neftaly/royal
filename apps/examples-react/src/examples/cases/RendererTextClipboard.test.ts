import { describe, expect, it } from 'vitest';
import { readRendererTextClipboardText } from './RendererTextClipboard';

describe('RendererText clipboard helper', () => {
  it('reports unavailable readText without requesting a custom paste fallback', async () => {
    await expect(readRendererTextClipboardText(undefined)).resolves.toEqual({
      message: 'navigator.clipboard.readText is unavailable',
      ok: false,
      reason: 'unavailable',
    });
  });

  it('reports Firefox async clipboard read denial without requesting a custom paste fallback', async () => {
    const clipboard = {
      readText: async () => {
        throw new DOMException('Read permission denied', 'NotAllowedError');
      },
    };

    await expect(readRendererTextClipboardText(clipboard)).resolves.toEqual({
      message: 'Read permission denied',
      ok: false,
      reason: 'denied',
    });
  });

  it('reports empty reads without requesting a custom paste fallback', async () => {
    const clipboard = {
      readText: async () => '',
    };

    await expect(readRendererTextClipboardText(clipboard)).resolves.toEqual({
      message: 'Clipboard text was empty',
      ok: false,
      reason: 'empty-paste',
    });
  });

  it('returns clipboard text when async reads succeed', async () => {
    const clipboard = {
      readText: async () => 'menu paste',
    };

    await expect(readRendererTextClipboardText(clipboard)).resolves.toEqual({
      ok: true,
      text: 'menu paste',
    });
  });
});
