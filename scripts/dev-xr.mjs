#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';

const port = readPort(process.env.ROYAL_XR_PORT, 5173);
const host = process.env.ROYAL_XR_HOST ?? '127.0.0.1';
const route = process.env.ROYAL_XR_ROUTE ?? '/webxr-vr';
const devtoolsPort = readPort(process.env.QUEST_DEVTOOLS_PORT, 9222);
const shouldOpenQuest = process.env.ROYAL_XR_OPEN_QUEST !== '0';
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

printUrls();
if (hasAdb()) {
  adb(['reverse', `tcp:${port}`, `tcp:${port}`], false);
  adb(['forward', `tcp:${devtoolsPort}`, 'localabstract:chrome_devtools_remote'], false);
} else {
  console.warn('adb unavailable; Quest tunnel skipped');
}

const child = spawn(
  pnpm,
  [
    '--dir',
    'apps/examples-react',
    'exec',
    'vite',
    '--config',
    'vite.config.ts',
    '--host',
    host,
    '--port',
    String(port),
    '--strictPort',
  ],
  { stdio: 'inherit' },
);

if (shouldOpenQuest && hasAdb()) {
  void openQuestWhenReady();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on('exit', (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

function readPort(input, fallback) {
  const parsed = Number.parseInt(input ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function printUrls() {
  console.log('');
  console.log('Royal XR dev');
  console.log(`  host:    http://${host}:${port}/`);
  console.log(`  headset: http://127.0.0.1:${port}${route}`);
  console.log(`  cdp:     http://127.0.0.1:${devtoolsPort}/json/list`);
  console.log('');
}

function hasAdb() {
  return spawnSync('adb', ['version'], { encoding: 'utf8' }).status === 0;
}

function adb(args, inherit) {
  const result = spawnSync('adb', args, {
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
  });
  if (result.status !== 0) {
    const message = result.stderr?.trim() || result.stdout?.trim() || `adb ${args.join(' ')} failed`;
    console.warn(message);
  }
}

async function openQuestWhenReady() {
  const url = `http://${host}:${port}/`;
  try {
    await waitForServer(url, 12_000);
  } catch {
    console.warn(`Quest browser launch skipped: ${url} did not respond yet.`);
    return;
  }

  adb([
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    `http://127.0.0.1:${port}${route}`,
    process.env.QUEST_BROWSER_PACKAGE ?? 'com.oculus.browser',
  ], true);
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw lastError ?? new Error('server did not become ready');
}
