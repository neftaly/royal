import { CdpSession, openCdpSocket, replaceWebSocketAuthority, waitForJson } from '../../apps/examples-react/scripts/browser-harness.mjs';

const connectBrowser = async ({ debugHost, debugPort, commandTimeoutMs }) => {
  const version = await waitForJson(`http://${debugHost}:${debugPort}/json/version`, 10000);
  if (!version.webSocketDebuggerUrl) throw new Error('Browser CDP endpoint unavailable');
  const socket = await openCdpSocket(replaceWebSocketAuthority(version.webSocketDebuggerUrl, debugHost, debugPort));
  return new CdpSession(socket, { commandTimeoutMs });
};

const connectPage = async ({ debugHost, debugPort, commandTimeoutMs, targetId }) => {
  const deadline = Date.now() + 10000;
  do {
    const pages = await waitForJson(`http://${debugHost}:${debugPort}/json/list`, Math.max(1, deadline-Date.now()));
    const page = pages.find(entry => entry.id === targetId && entry.type === 'page');
    if (page?.webSocketDebuggerUrl) {
      const socket = await openCdpSocket(replaceWebSocketAuthority(page.webSocketDebuggerUrl, debugHost, debugPort));
      return new CdpSession(socket, { commandTimeoutMs });
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error(`New research target ${targetId} did not expose a page endpoint`);
};

/** Never selects an existing page. Unsupported target creation fails closed. */
export const withResearchPage = async ({
  debugHost = '127.0.0.1', debugPort, commandTimeoutMs = 180000,
  connectBrowserImpl = connectBrowser, connectPageImpl = connectPage,
}, run) => {
  const options = { debugHost, debugPort, commandTimeoutMs };
  const browser = await connectBrowserImpl(options);
  let targetId, page, runFailed = false, runError;
  try {
    const created = await browser.call('Target.createTarget', { url: 'about:blank' });
    if (typeof created.targetId !== 'string' || !created.targetId) throw new Error('Browser did not create a research target');
    targetId = created.targetId;
    page = await connectPageImpl({ ...options, targetId });
    return await run(page);
  } catch (error) {
    runFailed = true; runError = error; throw error;
  } finally {
    try {
      if (targetId !== undefined) {
        const exists = async () => (await browser.call('Target.getTargets')).targetInfos.some(target => target.targetId === targetId);
        const deadline = Date.now() + 10000;
        do {
          try {
            const closed = await browser.call('Target.closeTarget', { targetId });
            if (!closed.success) throw new Error(`Could not close research target ${targetId}`);
          } catch (error) {
            // The page can disappear between checking it and requesting closure.
            if (await exists()) throw error;
          }
          if (!await exists()) break;
          if (Date.now() >= deadline) throw new Error(`Research target ${targetId} did not close`);
          // Chromium can acknowledge closure during navigation without closing.
          await new Promise(resolve => setTimeout(resolve, 50));
        } while (true);
      }
    } catch (error) {
      if (runFailed) throw new AggregateError([runError, error], 'Research run and tab cleanup failed');
      throw error;
    } finally { page?.close(); browser.close(); }
  }
};
