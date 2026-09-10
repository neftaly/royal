import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { connectCdpPage, evaluate, spawnLogged, stopProcess } from '../../apps/examples-react/scripts/browser-harness.mjs';
const ordinary = process.argv[3] === 'ordinary';
const base = process.argv[2] ?? 'http://127.0.0.1:4581';
const profile = await mkdtemp(path.join(tmpdir(), 'royal-capture-'));
const browser = spawnLogged('chromium', [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
  '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader',
  '--remote-debugging-port=4582', '--remote-allow-origins=*', `--user-data-dir=${profile}`, 'about:blank',
]);
let session;
try {
  session = await connectCdpPage({ debugHost: '127.0.0.1', debugPort: 4582, commandTimeoutMs: 60000 });
  const errors = [];
  session.on('Page.frameNavigated', (event) => console.error('Navigated:', event.frame.url));
  session.on('Inspector.targetCrashed', () => console.error('Browser target crashed'));
  await session.call('Runtime.enable');
  await session.call('Network.enable');
  session.on('Runtime.exceptionThrown', (event) => errors.push(event.exceptionDetails.text));
  session.on('Network.responseReceived', (event) => { if (event.response.status >= 400) errors.push(`${event.response.status} ${event.response.url}`); });
  let policyChanged = false;
  const runtimeRequests = [];
  session.on('Network.requestWillBeSent', (event) => {
    if (event.request.url.includes('/virtual-texture/runtime.ts')) runtimeRequests.push(event.request.url);
  });
  await session.call('Fetch.enable', { patterns: [
    { urlPattern: '*__onboarding-*', requestStage: 'Request' },
    ...(ordinary ? [{ urlPattern: '*automatic-policy.ts*', requestStage: 'Response' }] : []),
  ] });
  session.on('Fetch.requestPaused', async (event) => {
    try {
      const url = new URL(event.request.url);
      if (event.responseStatusCode !== undefined) {
        const response = await session.call('Fetch.getResponseBody', { requestId: event.requestId });
        const body = response.base64Encoded ? Buffer.from(response.body, 'base64').toString() : response.body;
        const modified = body.replace(/(const automaticVirtualTextureEligible = [\s\S]*?=> )/, '$1false && ');
        if (modified === body) throw new Error('Automatic VT experiment did not match the eligibility function');
        policyChanged = true;
        await session.call('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }], body: Buffer.from(modified).toString('base64') });
        return;
      }
      const file = url.pathname === '/__onboarding-ambient.ktx'
        ? '/home/neftaly/dev/probability/apps/onboarding/src/onboarding/ambient.ktx'
        : path.join('/home/neftaly/dev/probability/apps/site/public/onboarding-assets', url.pathname.replace('/__onboarding-assets/', ''));
      const bytes = await readFile(file);
      await session.call('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200, body: bytes.toString('base64') });
    } catch (error) {
      errors.push(String(error));
      await session.call('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Failed' });
    }
  });
  // A blank same-origin page avoids mounting an unrelated example renderer.
  await session.call('Page.enable');
  const loaded = session.wait('Page.loadEventFired', () => true, { timeoutMs: 10000 });
  await session.call('Page.navigate', { url: `${base}/@fs${path.resolve('research/image-capture/probe.html')}` });
  await loaded;
  const source = await evaluate(session, `fetch('/__royal-source.json').then(r => r.json())`);
  const moduleUrl = '/@fs' + path.resolve('research/image-capture/probe.ts');
  const results = await evaluate(session, `import(${JSON.stringify(moduleUrl)}).then(m => m.run())`);
  if (errors.length) throw new Error(errors.join('\n'));
  const catalog = results.classicDie;
  const rgba = Buffer.from(catalog.rgbaBase64, 'base64');
  await writeFile(new URL(ordinary ? './ordinary.png' : './default.png', import.meta.url), Buffer.from(catalog.pngBase64, 'base64'));
  delete catalog.rgbaBase64;
  delete catalog.pngBase64;
  if (ordinary) {
    const reference = await readFile('/tmp/royal-capture-default.rgba');
    if (reference.length !== rgba.length) throw new Error('Capture dimensions differ');
    let maxChannelDifference = 0, changedPixels = 0, totalDifference = 0;
    for (let pixel = 0; pixel < rgba.length; pixel += 4) {
      let changed = false;
      for (let channel = 0; channel < 4; channel++) {
        const delta = Math.abs(reference[pixel + channel] - rgba[pixel + channel]);
        maxChannelDifference = Math.max(maxChannelDifference, delta);
        totalDifference += delta;
        changed ||= delta !== 0;
      }
      if (changed) changedPixels++;
    }
    catalog.pixelComparison = { maxChannelDifference, changedPixels, meanAbsoluteChannelDifference: totalDifference / rgba.length };
  } else await writeFile('/tmp/royal-capture-default.rgba', rgba);
  if (ordinary && !policyChanged) throw new Error('Ordinary-texture experiment did not run');
  const report = { source, policy: ordinary ? 'automatic raster VT disabled in intercepted browser module only' : 'default',
    browser: 'Chromium SwiftShader; correctness and exploratory measurements only', runtimeRequests, results };
  await writeFile(new URL(ordinary ? './ordinary-results.json' : './default-results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  session?.close();
  await stopProcess(browser);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
