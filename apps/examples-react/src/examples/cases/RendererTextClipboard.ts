export type RendererTextClipboardAction = 'copy' | 'cut' | 'paste';
export type RendererTextClipboardReason =
  | 'denied'
  | 'empty-paste'
  | 'empty-selection'
  | 'error'
  | 'success'
  | 'unavailable';

export type RendererTextClipboardReadResult =
  | {
    readonly ok: true;
    readonly text: string;
  }
  | {
    readonly fallback: boolean;
    readonly message: string;
    readonly ok: false;
    readonly reason: Exclude<RendererTextClipboardReason, 'empty-selection' | 'success'>;
  };

export const rendererTextClipboardErrorReason = (
  error: unknown,
): Extract<RendererTextClipboardReason, 'denied' | 'error'> =>
  error instanceof DOMException && error.name === 'NotAllowedError' ? 'denied' : 'error';

export const rendererTextClipboardErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const readRendererTextClipboardText = async (
  clipboardApi: Pick<Clipboard, 'readText'> | undefined,
): Promise<RendererTextClipboardReadResult> => {
  if (clipboardApi === undefined || typeof clipboardApi.readText !== 'function') {
    return {
      fallback: true,
      message: 'navigator.clipboard.readText is unavailable',
      ok: false,
      reason: 'unavailable',
    };
  }

  try {
    const text = await clipboardApi.readText();
    return text === ''
      ? {
        fallback: false,
        message: 'Clipboard text was empty',
        ok: false,
        reason: 'empty-paste',
      }
      : { ok: true, text };
  } catch (error) {
    return {
      fallback: true,
      message: rendererTextClipboardErrorMessage(error),
      ok: false,
      reason: rendererTextClipboardErrorReason(error),
    };
  }
};
