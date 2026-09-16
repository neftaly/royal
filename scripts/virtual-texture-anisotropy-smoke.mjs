import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { connectCdpPage, evaluate, stopProcess } from '../apps/examples-react/scripts/browser-harness.mjs';

// A private, fresh Vite server serves this checkout directly; no existing app or deployment is used.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), 'royal-anisotropy-smoke-'));
const server = await createServer({
  root: repoRoot,
  configFile: path.join(repoRoot, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, strictPort: true },
  plugins: [{
    name: 'anisotropy-smoke-page',
    configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        if (request.url !== '/') return next();
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>Royal VT anisotropy regression</title><body>');
      });
    },
  }],
});
let browser;
let session;
try {
  await server.listen();
  const address = server.httpServer.address();
  assert(address !== null && typeof address === 'object');
  browser = spawn(process.env.CHROMIUM_PATH ?? 'chromium', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  let debugPort;
  const deadline = Date.now() + 10_000;
  while (debugPort === undefined) {
    try {
      debugPort = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
    } catch (error) {
      if (Date.now() > deadline || browser.exitCode !== null) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  session = await connectCdpPage({ debugHost: '127.0.0.1', debugPort, commandTimeoutMs: 60_000 });
  await session.call('Page.enable');
  const loaded = session.wait('Page.loadEventFired', () => true, { timeoutMs: 10_000 });
  await session.call('Page.navigate', { url: `http://127.0.0.1:${address.port}/` });
  await loaded;
  const result = await evaluate(session, `(async () => {
    const { runVirtualTextureAnisotropySmoke } = await import('/scripts/fixtures/virtual-texture-anisotropy.mjs');
    return runVirtualTextureAnisotropySmoke();
  })()`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  session?.close();
  if (browser !== undefined) await stopProcess(browser);
  await server.close();
  await rm(profile, { recursive: true, force: true });
}
