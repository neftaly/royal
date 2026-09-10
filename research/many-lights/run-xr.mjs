import { writeFile } from 'node:fs/promises';
import { connectCdpPage, evaluate } from '../../apps/examples-react/scripts/browser-harness.mjs';
const session = await connectCdpPage({ debugHost: '127.0.0.1', debugPort: 9222, commandTimeoutMs: 180000 });
try {
  await session.call('Page.enable');
  const loaded = session.wait('Page.loadEventFired', () => true, { timeoutMs: 30000 });
  await session.call('Page.navigate', { url: 'http://127.0.0.1:4583/@fs/home/neftaly/dev/royal/research/many-lights/probe.html' }); await loaded;
  await evaluate(session, "import('/@fs/home/neftaly/dev/royal/research/many-lights/xr-probe.ts').then(m=>{window.runXrProbe=m.runXrProbe})");
  const options = JSON.parse(process.env.LIGHTS_OPTIONS ?? '{}');
  const response = await session.call('Runtime.evaluate', { expression: `window.runXrProbe(${JSON.stringify(options)})`, userGesture: true, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  const destination = process.env.LIGHTS_REPORT ?? 'research/many-lights/quest-xr-results.json';
  await writeFile(destination, JSON.stringify(response.result.value, null, 2)+'\n');
  console.log(destination);
} finally { session.close(); }
