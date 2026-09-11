import { describe, expect, it, vi } from 'vitest';
import { withResearchPage } from '../../research/many-lights/research-page.mjs';

const harness = () => {
  const browser = { call: vi.fn(async method => method === 'Target.createTarget' ? { targetId: 'owned' } : method === 'Target.getTargets' ? { targetInfos: [] } : { success: true }), close: vi.fn() };
  const page = { close: vi.fn() };
  return { browser, page, options: { debugPort: 9222, connectBrowserImpl: vi.fn(async () => browser), connectPageImpl: vi.fn(async () => page) } };
};

describe('research browser target ownership', () => {
  it('creates and closes its own target around a successful run', async () => {
    const h = harness(), run = vi.fn(async () => 'result');
    await expect(withResearchPage(h.options, run)).resolves.toBe('result');
    expect(h.browser.call.mock.calls).toEqual([
      ['Target.createTarget', { url: 'about:blank' }],
      ['Target.closeTarget', { targetId: 'owned' }],
      ['Target.getTargets'],
    ]);
    expect(h.options.connectPageImpl).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'owned' }));
    expect(run).toHaveBeenCalledWith(h.page);
    expect(h.page.close).toHaveBeenCalledOnce(); expect(h.browser.close).toHaveBeenCalledOnce();
  });

  it.each(['connection', 'run'])('closes only its owned target when %s fails', async phase => {
    const h = harness(), failure = new Error('failed');
    if (phase === 'connection') h.options.connectPageImpl.mockRejectedValueOnce(failure);
    await expect(withResearchPage(h.options, async () => { throw failure; })).rejects.toBe(failure);
    expect(h.browser.call).toHaveBeenCalledWith('Target.closeTarget', { targetId: 'owned' });
    expect(h.browser.close).toHaveBeenCalledOnce();
  });

  it('never falls back to an existing tab when target creation is unsupported', async () => {
    const h = harness(), run = vi.fn();
    h.browser.call.mockRejectedValueOnce(new Error('unsupported'));
    await expect(withResearchPage(h.options, run)).rejects.toThrow('unsupported');
    expect(h.options.connectPageImpl).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
    expect(h.browser.call).toHaveBeenCalledOnce(); expect(h.browser.close).toHaveBeenCalledOnce();
  });

  it('retries an acknowledged close when navigation keeps the owned target alive', async () => {
    const h = harness();
    let checks = 0;
    h.browser.call.mockImplementation(async method => {
      if (method === 'Target.createTarget') return { targetId: 'owned' };
      if (method === 'Target.getTargets') return { targetInfos: ++checks === 1 ? [{ targetId: 'owned' }, { targetId: 'personal' }] : [{ targetId: 'personal' }] };
      return { success: true };
    });
    await withResearchPage(h.options, async () => {});
    expect(h.browser.call.mock.calls.filter(([method]) => method === 'Target.closeTarget')).toEqual([
      ['Target.closeTarget', { targetId: 'owned' }], ['Target.closeTarget', { targetId: 'owned' }],
    ]);
  });

  it('accepts a target disappearing before the close command', async () => {
    const h = harness();
    h.browser.call.mockImplementation(async method => {
      if (method === 'Target.createTarget') return { targetId: 'owned' };
      if (method === 'Target.getTargets') return { targetInfos: [] };
      throw new Error('No target with given id');
    });
    await expect(withResearchPage(h.options, async () => 'result')).resolves.toBe('result');
    expect(h.browser.close).toHaveBeenCalledOnce();
  });

  it('reports both a run failure and cleanup failure', async () => {
    const h = harness(), failure = new Error('failed');
    h.browser.call.mockImplementation(async method => method === 'Target.createTarget' ? { targetId: 'owned' } : method === 'Target.getTargets' ? { targetInfos: [{ targetId: 'owned' }] } : { success: false });
    await expect(withResearchPage(h.options, async () => { throw failure; })).rejects.toMatchObject({ errors: [failure, expect.any(Error)] });
    expect(h.browser.close).toHaveBeenCalledOnce();
  });
});
