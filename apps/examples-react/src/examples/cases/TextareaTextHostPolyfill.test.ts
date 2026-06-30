import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { examples } from '../../examples';

const sourcePath = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  'TextareaTextHostPolyfill.tsx',
);

describe('TextareaTextHostPolyfill lab route', () => {
  it('stays out of the primary examples catalog', () => {
    expect(examples.some((example) => example.path.includes('textarea-text-host'))).toBe(false);
    expect(examples.some((example) => example.sourceFile.includes('TextareaTextHostPolyfill'))).toBe(
      false,
    );
  });

  it('uses a native textarea host without adding a clipboard cache or custom clipboard data path', async () => {
    const source = await readFile(sourcePath, 'utf8');

    expect(source).toContain("type HostMode = 'overlay' | 'offscreen'");
    expect(source).toContain("createElement('textarea'");
    expect(source).toContain('internalClipboardCache: false');
    expect(source).toContain("data-text-host-mode");
    expect(source).not.toMatch(/\bnavigator\.clipboard\b/);
    expect(source).not.toMatch(/\bclipboardData\.(?:getData|setData)\b/);
    expect(source).not.toMatch(/\b(?:clipboardCache|internalClipboard|clipboardBridge)\b/);
  });
});
