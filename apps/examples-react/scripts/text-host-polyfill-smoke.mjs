import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const appRoot = path.resolve(new URL('..', import.meta.url).pathname);
const host = '127.0.0.1';
const previewPort = Number(process.env.EXAMPLES_TEXT_HOST_PORT ?? 4593);
const debugPort = Number(process.env.EXAMPLES_TEXT_HOST_DEBUG_PORT ?? 4594);
const baseUrl = `http://${host}:${previewPort}`;
const routeUrl = `${baseUrl}/labs/textarea-text-host-polyfill`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForHttp = async (url, timeoutMs) => {
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
    await sleep(100);
  }

  throw lastError ?? new Error(`Timed out waiting for ${url}`);
};

const waitForJson = async (url, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }

  throw lastError ?? new Error(`Timed out waiting for ${url}`);
};

class CdpSession {
  #nextId = 1;
  #pending = new Map();
  #handlers = new Map();

  constructor(socket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const pending = this.#pending.get(message.id);
        if (pending === undefined) return;
        this.#pending.delete(message.id);
        if (message.error === undefined) {
          pending.resolve(message.result);
        } else {
          pending.reject(new Error(message.error.message));
        }
        return;
      }

      for (const handler of this.#handlers.get(message.method) ?? []) {
        handler(message.params);
      }
    });
  }

  on(method, handler) {
    this.#handlers.set(method, [...(this.#handlers.get(method) ?? []), handler]);
  }

  once(method) {
    return new Promise((resolve) => {
      const handler = (params) => {
        this.#handlers.set(
          method,
          (this.#handlers.get(method) ?? []).filter((entry) => entry !== handler),
        );
        resolve(params);
      };
      this.on(method, handler);
    });
  }

  call(method, params = {}) {
    const id = this.#nextId;
    this.#nextId += 1;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { reject, resolve });
    });
  }

  close() {
    this.socket.close();
  }
}

const connectPage = async () => {
  await waitForJson(`http://${host}:${debugPort}/json/version`, 10_000);
  const pages = await waitForJson(`http://${host}:${debugPort}/json/list`, 10_000);
  const page = pages.find((entry) => entry.type === 'page');
  if (page?.webSocketDebuggerUrl === undefined) {
    throw new Error('Chromium did not expose a debuggable page target');
  }

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await once(socket, 'open');
  return new CdpSession(socket);
};

const evaluate = async (session, expression, options = {}) => {
  const result = await session.call('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true,
    ...options,
  });

  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.text);
  }

  return result.result.value;
};

const probeExpression = `
(() => {
  const probe = window.__royalTextareaHostProbe;
  const textarea = document.querySelector('textarea[aria-label="Textarea-backed text host"]');
  const canvas = document.querySelector('canvas[aria-label="Textarea text host canvas"]');
  const sampleCanvas = (target, maxSize = 128) => {
    if (!(target instanceof HTMLCanvasElement)) return undefined;
    const width = Math.max(1, Math.min(maxSize, target.width));
    const height = Math.max(1, Math.min(maxSize, target.height));
    const sample = document.createElement('canvas');
    sample.width = width;
    sample.height = height;
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (context === null) return undefined;
    context.drawImage(target, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const buckets = new Set();
    let paintedPixels = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3];
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      if (alpha !== 0 && (red > 8 || green > 8 || blue > 8)) paintedPixels += 1;
      buckets.add(\`\${red >> 5}:\${green >> 5}:\${blue >> 5}:\${alpha >> 6}\`);
    }

    return {
      colorBuckets: buckets.size,
      paintedPixels,
      paintedRatio: paintedPixels / (width * height),
    };
  };

  if (probe === undefined || !(textarea instanceof HTMLTextAreaElement)) {
    return { ok: false, reason: 'missing textarea host probe' };
  }

  const eventState = probe.eventState ?? {};
  const counters = eventState.counters ?? {};
  const last = eventState.last ?? {};
  const lastContextMenu = eventState.lastContextMenu ?? {};
  const hostRect = textarea.getBoundingClientRect();
  const canvasRect = canvas instanceof HTMLCanvasElement
    ? canvas.getBoundingClientRect()
    : { height: 0, left: 0, top: 0, width: 0 };

  return {
    activeElementTag: document.activeElement?.tagName?.toLowerCase() ?? '',
    canvas: {
      height: canvasRect.height,
      sample: sampleCanvas(canvas),
      width: canvasRect.width,
    },
    counters: {
      beforeInput: Number(counters.beforeInput ?? 0),
      compositionEnd: Number(counters.compositionEnd ?? 0),
      compositionStart: Number(counters.compositionStart ?? 0),
      compositionUpdate: Number(counters.compositionUpdate ?? 0),
      contextMenuCanvas: Number(counters.contextMenuCanvas ?? 0),
      contextMenuTextarea: Number(counters.contextMenuTextarea ?? 0),
      copy: Number(counters.copy ?? 0),
      cut: Number(counters.cut ?? 0),
      focus: Number(counters.focus ?? 0),
      input: Number(counters.input ?? 0),
      keydown: Number(counters.keydown ?? 0),
      paste: Number(counters.paste ?? 0),
      select: Number(counters.select ?? 0),
    },
    host: {
      active: document.activeElement === textarea,
      height: hostRect.height,
      left: hostRect.left,
      top: hostRect.top,
      width: hostRect.width,
    },
    internalClipboardCache: probe.internalClipboardCache === false ? false : true,
    last: {
      defaultPrevented: last.defaultPrevented === true,
      inputType: String(last.inputType ?? ''),
      key: String(last.key ?? ''),
      target: String(last.target ?? ''),
      type: String(last.type ?? ''),
    },
    lastContextMenu: {
      defaultPrevented: lastContextMenu.defaultPrevented === true,
      target: String(lastContextMenu.target ?? ''),
      type: String(lastContextMenu.type ?? ''),
    },
    mode: String(probe.mode ?? ''),
    ok: true,
    selectedLength: Number(probe.selectedLength ?? 0),
    selection: {
      anchor: Number(probe.selection?.anchor ?? 0),
      focus: Number(probe.selection?.focus ?? 0),
    },
    text: String(probe.text ?? ''),
    textLength: Number(probe.textLength ?? 0),
  };
})()
`;

const spawnLogged = (command, args, options) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return child;
};

const stop = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), sleep(2000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
};

const waitForProbe = async (session, predicate, timeoutMs = 1600) => {
  const deadline = Date.now() + timeoutMs;
  let probe = await evaluate(session, probeExpression);

  while (Date.now() < deadline && !predicate(probe)) {
    await sleep(40);
    probe = await evaluate(session, probeExpression);
  }

  return probe;
};

const mutateProbe = async (session, expression) => evaluate(session, `
(() => {
  const probe = window.__royalTextareaHostProbe;
  if (probe === undefined) return { ok: false, reason: 'missing probe' };
  ${expression}
  return { ok: true };
})()
`, { userGesture: true });

const grantNativeClipboardPermissions = async (session) => {
  await session.call('Browser.grantPermissions', {
    origin: baseUrl,
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  });
};

const seedNativeTextClipboard = async (session, text) => evaluate(session, `
(async () => {
  await navigator.clipboard.writeText(${JSON.stringify(text)});
  const readback = await navigator.clipboard.readText();
  return { ok: readback === ${JSON.stringify(text)}, readbackLength: readback.length };
})()
`, { userGesture: true });

const readNativeTextClipboard = async (session) => evaluate(session, `
(async () => {
  const text = await navigator.clipboard.readText();
  return { ok: true, text, textLength: text.length };
})()
`, { userGesture: true });

const installReadTextTrap = async (session) => evaluate(session, `
(() => {
  const clipboard = navigator.clipboard;
  window.__royalTextareaHostReadTextTrap?.restore?.();
  const original = clipboard.readText.bind(clipboard);
  let calls = 0;
  Object.defineProperty(clipboard, 'readText', {
    configurable: true,
    value: async () => {
      calls += 1;
      throw new DOMException('textarea host readText trap', 'NotAllowedError');
    },
  });
  window.__royalTextareaHostReadTextTrap = {
    get calls() {
      return calls;
    },
    restore: () => {
      Object.defineProperty(clipboard, 'readText', {
        configurable: true,
        value: original,
      });
    },
  };
  return { ok: true };
})()
`);

const readReadTextTrap = async (session) => evaluate(session, `
(() => ({
  calls: Number(window.__royalTextareaHostReadTextTrap?.calls ?? 0),
  ok: window.__royalTextareaHostReadTextTrap !== undefined,
}))()
`);

const restoreReadTextTrap = async (session) => evaluate(session, `
(() => {
  window.__royalTextareaHostReadTextTrap?.restore?.();
  delete window.__royalTextareaHostReadTextTrap;
  return { ok: true };
})()
`);

const dispatchKeyboardShortcut = async (session, key) => {
  const normalizedKey = key.toLowerCase();
  const upperKey = normalizedKey.toUpperCase();
  const keyCode = upperKey.charCodeAt(0);
  const event = {
    code: `Key${upperKey}`,
    key: normalizedKey,
    modifiers: 2,
    nativeVirtualKeyCode: keyCode,
    windowsVirtualKeyCode: keyCode,
  };

  await session.call('Input.dispatchKeyEvent', { ...event, type: 'keyDown' });
  await session.call('Input.dispatchKeyEvent', { ...event, type: 'keyUp' });
};

const dispatchPrintableKey = async (session, key) => {
  const upperKey = key.toUpperCase();
  const keyCode = upperKey.charCodeAt(0);
  const event = {
    code: `Key${upperKey}`,
    key,
    nativeVirtualKeyCode: keyCode,
    text: key,
    unmodifiedText: key,
    windowsVirtualKeyCode: keyCode,
  };

  await session.call('Input.dispatchKeyEvent', { ...event, type: 'keyDown' });
  await session.call('Input.dispatchKeyEvent', { ...event, type: 'keyUp' });
};

const dispatchRightClick = async (session, point) => {
  const params = {
    button: 'right',
    buttons: 2,
    clickCount: 1,
    x: Number(point.x),
    y: Number(point.y),
  };

  await session.call('Input.dispatchMouseEvent', { ...params, type: 'mousePressed' });
  await session.call('Input.dispatchMouseEvent', { ...params, buttons: 0, type: 'mouseReleased' });
};

const textHostPoint = async (session) => evaluate(session, `
(() => {
  const canvas = document.querySelector('canvas[aria-label="Textarea text host canvas"]');
  if (!(canvas instanceof HTMLCanvasElement)) return { ok: false, reason: 'missing canvas' };
  const rect = canvas.getBoundingClientRect();
  return {
    ok: true,
    x: rect.left + rect.width * 0.5,
    y: rect.top + rect.height * 0.497,
  };
})()
`);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const runProbe = async (session) => {
  const ready = await waitForProbe(
    session,
    (probe) =>
      probe.ok === true &&
      probe.mode === 'overlay' &&
      probe.host.active === true &&
      (probe.canvas.sample?.paintedPixels ?? 0) > 0,
    8000,
  );

  assert(ready.ok === true, ready.reason ?? 'probe was not ready');
  assert(ready.internalClipboardCache === false, 'probe reported an internal clipboard cache');
  assert((ready.canvas.sample?.colorBuckets ?? 0) >= 3, 'canvas text scene did not paint enough color variation');

  const beforeType = ready;
  await mutateProbe(session, 'probe.selectRange(probe.textLength, probe.textLength); probe.focusHost();');
  await dispatchPrintableKey(session, 'z');
  const afterType = await waitForProbe(
    session,
    (probe) =>
      probe.counters.keydown > beforeType.counters.keydown &&
      probe.counters.input > beforeType.counters.input &&
      probe.text.endsWith('z'),
  );
  assert(afterType.text.endsWith('z'), 'focused textarea did not accept native keyboard insertion');

  await mutateProbe(session, 'probe.selectRange(0, 18); probe.focusHost();');
  const beforeCopy = await waitForProbe(session, (probe) => probe.selectedLength === 18);
  const expectedCopy = beforeCopy.text.slice(0, 18);
  await dispatchKeyboardShortcut(session, 'c');
  const afterCopy = await waitForProbe(
    session,
    (probe) => probe.counters.copy > beforeCopy.counters.copy,
  );
  const clipboardAfterCopy = await readNativeTextClipboard(session);
  assert(afterCopy.last.target === 'textarea', 'copy event did not target the textarea');
  assert(clipboardAfterCopy.text === expectedCopy, 'native clipboard copy readback did not match textarea selection');

  await mutateProbe(session, 'probe.selectRange(0, 18); probe.focusHost();');
  const beforeCut = await waitForProbe(session, (probe) => probe.selectedLength === 18);
  await dispatchKeyboardShortcut(session, 'x');
  const afterCut = await waitForProbe(
    session,
    (probe) =>
      probe.counters.cut > beforeCut.counters.cut &&
      probe.counters.input > beforeCut.counters.input &&
      probe.textLength < beforeCut.textLength,
  );
  const clipboardAfterCut = await readNativeTextClipboard(session);
  assert(afterCut.last.target === 'textarea', 'cut event did not target the textarea');
  assert(clipboardAfterCut.text === beforeCut.text.slice(0, 18), 'native clipboard cut readback did not match selection');

  const pasteText = ` native-paste-${Date.now().toString(36)} `;
  const pasteSeed = await seedNativeTextClipboard(session, pasteText);
  assert(pasteSeed.ok === true, 'could not seed native clipboard for paste');
  await mutateProbe(session, 'probe.selectRange(probe.textLength, probe.textLength); probe.focusHost();');
  const beforePaste = await waitForProbe(session, (probe) => probe.host.active === true);
  const trap = await installReadTextTrap(session);
  assert(trap.ok === true, 'could not install readText trap');
  await dispatchKeyboardShortcut(session, 'v');
  const afterPaste = await waitForProbe(
    session,
    (probe) =>
      probe.counters.paste > beforePaste.counters.paste &&
      probe.counters.input > beforePaste.counters.input &&
      probe.text.includes(pasteText),
  );
  const trapAfterPaste = await readReadTextTrap(session);
  await restoreReadTextTrap(session);
  const clipboardAfterPaste = await readNativeTextClipboard(session);
  assert(afterPaste.last.target === 'textarea', 'paste event did not target the textarea');
  assert(trapAfterPaste.calls === 0, 'app path called navigator.clipboard.readText during native paste');
  assert(clipboardAfterPaste.text === pasteText, 'native paste changed clipboard contents unexpectedly');

  const beforeComposition = afterPaste;
  const composition = await evaluate(session, `
(() => {
  const textarea = document.querySelector('textarea[aria-label="Textarea-backed text host"]');
  if (!(textarea instanceof HTMLTextAreaElement)) return { ok: false, reason: 'missing textarea' };
  textarea.focus({ preventScroll: true });
  textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
  textarea.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: 'ime' }));
  textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'ime' }));
  return { ok: true };
})()
`, { userGesture: true });
  assert(composition.ok === true, composition.reason ?? 'composition dispatch failed');
  const afterComposition = await waitForProbe(
    session,
    (probe) =>
      probe.counters.compositionStart > beforeComposition.counters.compositionStart &&
      probe.counters.compositionUpdate > beforeComposition.counters.compositionUpdate &&
      probe.counters.compositionEnd > beforeComposition.counters.compositionEnd,
  );
  assert(afterComposition.last.target === 'textarea', 'composition events did not target textarea');

  const overlayPoint = await textHostPoint(session);
  assert(overlayPoint.ok === true, overlayPoint.reason ?? 'missing overlay point');
  const beforeOverlayMenu = afterComposition;
  await dispatchRightClick(session, overlayPoint);
  const afterOverlayMenu = await waitForProbe(
    session,
    (probe) => probe.counters.contextMenuTextarea > beforeOverlayMenu.counters.contextMenuTextarea,
  );
  assert(afterOverlayMenu.lastContextMenu.target === 'textarea', 'overlay right-click did not target textarea');
  assert(afterOverlayMenu.lastContextMenu.defaultPrevented === false, 'overlay right-click was prevented');

  await mutateProbe(session, "probe.setMode('offscreen');");
  const offscreenReady = await waitForProbe(
    session,
    (probe) => probe.mode === 'offscreen' && probe.host.active === true && probe.host.left < -1000,
  );
  assert(offscreenReady.mode === 'offscreen', 'probe did not switch to offscreen mode');
  await mutateProbe(session, 'probe.selectRange(probe.textLength, probe.textLength); probe.focusHost();');
  await dispatchPrintableKey(session, 'q');
  const afterOffscreenType = await waitForProbe(
    session,
    (probe) =>
      probe.mode === 'offscreen' &&
      probe.counters.input > offscreenReady.counters.input &&
      probe.text.endsWith('q'),
  );
  assert(afterOffscreenType.text.endsWith('q'), 'offscreen focused textarea did not accept keyboard insertion');

  const offscreenPoint = await textHostPoint(session);
  const beforeOffscreenMenu = afterOffscreenType;
  await dispatchRightClick(session, offscreenPoint);
  const afterOffscreenMenu = await waitForProbe(
    session,
    (probe) => probe.counters.contextMenuCanvas > beforeOffscreenMenu.counters.contextMenuCanvas,
  );
  assert(
    afterOffscreenMenu.lastContextMenu.target === 'canvas',
    `offscreen right-click did not target canvas; target=${afterOffscreenMenu.lastContextMenu.target}` +
      ` last=${afterOffscreenMenu.last.type}/${afterOffscreenMenu.last.target}` +
      ` canvasMenus=${afterOffscreenMenu.counters.contextMenuCanvas}` +
      ` textareaMenus=${afterOffscreenMenu.counters.contextMenuTextarea}`,
  );
  assert(afterOffscreenMenu.lastContextMenu.defaultPrevented === false, 'offscreen right-click was prevented');

  return {
    afterCopy: {
      copiedLength: clipboardAfterCopy.textLength,
    },
    afterCut: {
      cutLength: clipboardAfterCut.textLength,
      textLength: afterCut.textLength,
    },
    afterPaste: {
      pasteLength: pasteText.length,
      readTextTrapCalls: trapAfterPaste.calls,
      textLength: afterPaste.textLength,
    },
    contextMenu: {
      offscreenTarget: afterOffscreenMenu.lastContextMenu.target,
      overlayTarget: afterOverlayMenu.lastContextMenu.target,
    },
    keyboard: {
      offscreenInserted: afterOffscreenType.text.endsWith('q'),
      overlayInserted: afterType.text.endsWith('z'),
    },
  };
};

const main = async () => {
  const profileDir = await mkdtemp(path.join(tmpdir(), 'royal-text-host-smoke-'));
  const preview = spawnLogged('pnpm', [
    'exec',
    'vite',
    'preview',
    '--config',
    'vite.config.ts',
    '--host',
    host,
    '--port',
    String(previewPort),
    '--strictPort',
  ], { cwd: appRoot });
  const browser = spawnLogged('chromium', [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], { cwd: appRoot });

  let session;
  const exceptions = [];

  try {
    await waitForHttp(baseUrl, 15_000);
    session = await connectPage();
    session.on('Runtime.exceptionThrown', (event) => {
      exceptions.push(event.exceptionDetails?.text ?? 'Runtime exception');
    });
    await session.call('Page.enable');
    await session.call('Runtime.enable');
    await grantNativeClipboardPermissions(session);

    const loaded = session.once('Page.loadEventFired');
    await session.call('Page.navigate', { url: routeUrl });
    await loaded;
    const result = await runProbe(session);

    if (exceptions.length > 0) {
      throw new Error('Browser runtime exceptions: ' + exceptions.join('; '));
    }

    console.log(
      `ok textarea text host polyfill overlay=${result.contextMenu.overlayTarget}` +
        ` offscreen=${result.contextMenu.offscreenTarget}` +
        ` pasteLength=${result.afterPaste.pasteLength}` +
        ` readTextTrapCalls=${result.afterPaste.readTextTrapCalls}`,
    );
  } finally {
    session?.close();
    await stop(browser);
    await stop(preview);
    await rm(profileDir, {
      force: true,
      maxRetries: 3,
      recursive: true,
      retryDelay: 100,
    });
  }
};

await main();
