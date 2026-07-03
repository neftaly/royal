#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const command = process.argv[2] ?? 'status';
const args = process.argv.slice(3);
const appPort = readPort(process.env.ROYAL_XR_PORT, 5173);
const devtoolsPort = readPort(process.env.QUEST_DEVTOOLS_PORT, 9222);
const browserPackage = process.env.QUEST_BROWSER_PACKAGE ?? 'com.oculus.browser';
const defaultRoute = process.env.ROYAL_XR_ROUTE ?? '/webxr-vr';
const defaultUrl = `http://127.0.0.1:${appPort}${defaultRoute}`;
const commands = new Set(['devices', 'forward', 'open', 'packages', 'reverse', 'status', 'tabs']);

if (!commands.has(command)) usage(1);

if (command === 'status') {
  requireAdb();
  adb(['devices', '-l']);
  console.log('');
  adb(['reverse', '--list']);
  console.log('');
  await printTabs(false);
} else if (command === 'devices') {
  requireAdb();
  adb(['devices', '-l']);
} else if (command === 'packages') {
  requireAdb();
  adb(['shell', 'pm', 'list', 'packages']);
} else if (command === 'reverse') {
  requireAdb();
  adb(['reverse', `tcp:${appPort}`, `tcp:${appPort}`]);
  console.log(`forwarded Quest http://127.0.0.1:${appPort}/ to host localhost:${appPort}`);
} else if (command === 'forward') {
  requireAdb();
  adb(['forward', `tcp:${devtoolsPort}`, 'localabstract:chrome_devtools_remote']);
  console.log(`forwarded Quest DevTools to http://127.0.0.1:${devtoolsPort}/json/list`);
} else if (command === 'tabs') {
  await printTabs(true);
} else if (command === 'open') {
  const url = args[0] ?? defaultUrl;
  requireAdb();
  adb([
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    url,
    browserPackage,
  ]);
}

function readPort(input, fallback) {
  const parsed = Number.parseInt(input ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function usage(exitCode) {
  console.error([
    'usage: pnpm quest:browser <command>',
    '',
    'commands:',
    '  status      show ADB devices, reverse tunnels, and forwarded browser tabs',
    '  devices     show ADB devices',
    '  packages    list Android packages on the headset',
    '  reverse     reverse Quest localhost to the Royal dev server',
    '  forward     forward Quest browser DevTools to host localhost',
    '  tabs        list forwarded Quest browser tabs',
    '  open [URL]  open a URL in Quest Browser',
    '',
    'env:',
    '  ROYAL_XR_PORT=5173',
    '  ROYAL_XR_ROUTE=/webxr-vr',
    '  QUEST_DEVTOOLS_PORT=9222',
    '  QUEST_BROWSER_PACKAGE=com.oculus.browser',
  ].join('\n'));
  process.exit(exitCode);
}

function requireAdb() {
  if (spawnSync('adb', ['version'], { encoding: 'utf8' }).status === 0) return;
  console.error('adb is not available on PATH.');
  process.exit(1);
}

function adb(args) {
  const result = spawnSync('adb', args, { encoding: 'utf8', stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function printTabs(requireForward) {
  try {
    const response = await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    console.log(JSON.stringify(await response.json(), null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (requireForward) {
      console.error(`DevTools tabs unavailable: ${message}`);
      console.error('run: pnpm quest:browser forward');
      process.exit(1);
    }
    console.log(`DevTools tabs unavailable: ${message}`);
    console.log('run: pnpm quest:browser forward');
  }
}
