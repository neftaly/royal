import { describe, expect, it } from 'vitest';
import { readRendererTextClipboardText } from './RendererTextClipboard';

describe('RendererText clipboard helper', () => {
  it('uses a native paste bridge when readText is unavailable', async () => {
    await expect(readRendererTextClipboardText(undefined)).resolves.toEqual({
      fallback: true,
      message: 'navigator.clipboard.readText is unavailable',
      ok: false,
      reason: 'unavailable',
    });
  });

  it('uses a native paste bridge when Firefox denies async clipboard reads', async () => {
    const clipboard = {
      readText: async () => {
        throw new DOMException('Read permission denied', 'NotAllowedError');
      },
    };

    await expect(readRendererTextClipboardText(clipboard)).resolves.toEqual({
      fallback: true,
      message: 'Read permission denied',
      ok: false,
      reason: 'denied',
    });
  });

  it('reports empty reads without opening the paste bridge', async () => {
    const clipboard = {
      readText: async () => '',
    };

    await expect(readRendererTextClipboardText(clipboard)).resolves.toEqual({
      fallback: false,
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
