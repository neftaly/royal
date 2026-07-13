import { describe, expect, it } from 'vitest';

import {
  replaceWebSocketAuthority,
  waitForHttp,
  waitForJson,
} from './browser-harness.mjs';

describe('browser harness', () => {
  it('rewrites a remote CDP authority without changing the target path', () => {
    expect(replaceWebSocketAuthority(
      'ws://127.0.0.1:9222/devtools/page/abc?token=123',
      'quest.local',
      4774,
    )).toBe('ws://quest.local:4774/devtools/page/abc?token=123');
  });

  it('retries HTTP readiness checks and parses the successful JSON response', async () => {
    let attempts = 0;
    const fetchImpl = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('not ready');
      return {
        json: async () => ({ ready: true }),
        ok: true,
        status: 200,
      };
    };

    await expect(waitForJson('http://example.test/status', 1_000, fetchImpl))
      .resolves.toEqual({ ready: true });
    expect(attempts).toBe(2);
  });

  it('reports the final unsuccessful HTTP status', async () => {
    const fetchImpl = async () => ({ ok: false, status: 503 });

    await expect(waitForHttp('http://example.test/status', 1, fetchImpl))
      .rejects.toThrow('http://example.test/status returned 503');
  });
});
