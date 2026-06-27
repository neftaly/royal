import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  CompressedTextureFormatRow,
  ContextVersionRow,
  GpuTimerQuerySupportRow,
  RendererCapabilityProbeResult,
  RendererCapabilityProbeRow,
  RendererCapabilityRow,
  TextureLimitRow,
  WebGpuProbeInput,
  WebGlExtensionRow,
  WebGlLikeContext
} from '../packages/react-royal-fiber/src/webgl/webgl-capabilities';

type Mode = 'check' | 'profile';

type CdpMessage = {
  readonly id?: number;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly message: string };
  readonly sessionId?: string;
};

type WebGlReport = {
  readonly canvas: { readonly height: number; readonly width: number } | null;
  readonly capabilities: RendererCapabilityProbeResult;
  readonly differentPixels: number;
  readonly drawCalls: number;
  readonly firstDrawMs: number | null;
  readonly renderer: string;
  readonly vendor: string;
};

type BrowserCapabilitySnapshot = {
  readonly compressedTextureFormats: readonly number[];
  readonly constants: {
    readonly COMPRESSED_TEXTURE_FORMATS: number;
    readonly MAX_COMBINED_TEXTURE_IMAGE_UNITS: number;
    readonly MAX_TEXTURE_IMAGE_UNITS: number;
    readonly MAX_TEXTURE_SIZE: number;
    readonly RENDERER: number;
    readonly SHADING_LANGUAGE_VERSION: number;
    readonly VENDOR: number;
    readonly VERSION: number;
    readonly READ_BUFFER?: number;
    readonly TEXTURE_3D?: number;
  };
  readonly extensionNames: readonly string[];
  readonly extensionObjects: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly maxCombinedTextureImageUnits: number | null;
  readonly maxTextureImageUnits: number | null;
  readonly maxTextureSize: number | null;
  readonly renderer: string | null;
  readonly shadingLanguageVersion: string | null;
  readonly vendor: string | null;
  readonly version: 1 | 2;
  readonly versionLabel: string | null;
  readonly webgpu: WebGpuProbeInput;
};

type BrowserWebGlReport = Omit<WebGlReport, 'capabilities'> & {
  readonly capabilitySnapshot: BrowserCapabilitySnapshot | null;
};

const chromiumArgs = (userDataDir: string): readonly string[] => [
  '--headless=new',
  '--remote-debugging-port=0',
  `--user-data-dir=${userDataDir}`,
  '--use-gl=angle',
  '--use-angle=default',
  '--enable-gpu',
  '--ignore-gpu-blocklist',
  '--disable-software-rasterizer',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--no-first-run',
  'about:blank'
];

class CdpClient {
  readonly #pending = new Map<
    number,
    {
      readonly reject: (error: Error) => void;
      readonly resolve: (value: unknown) => void;
    }
  >();
  readonly #waiters: Array<{
    readonly method: string;
    readonly resolve: (message: CdpMessage) => void;
    readonly sessionId?: string;
  }> = [];
  readonly socket: WebSocket;
  #nextId = 1;

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;

      if (message.id !== undefined) {
        const pending = this.#pending.get(message.id);
        if (pending === undefined) return;
        this.#pending.delete(message.id);

        if (message.error !== undefined) {
          pending.reject(new Error(message.error.message));
          return;
        }

        pending.resolve(message.result);
        return;
      }

      for (const waiter of this.#waiters) {
        if (
          waiter.method === message.method &&
          (waiter.sessionId === undefined || waiter.sessionId === message.sessionId)
        ) {
          this.#waiters.splice(this.#waiters.indexOf(waiter), 1);
          waiter.resolve(message);
          return;
        }
      }
    });
  }

  send<T>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string
  ): Promise<T> {
    const id = this.#nextId;
    this.#nextId += 1;
    const message = sessionId === undefined
      ? { id, method, params }
      : { id, method, params, sessionId };

    return new Promise((resolve, reject) => {
      this.#pending.set(id, {
        reject,
        resolve: (value) => resolve(value as T)
      });
      this.socket.send(JSON.stringify(message));
    });
  }

  waitFor(method: string, sessionId?: string): Promise<CdpMessage> {
    return new Promise((resolve) => {
      this.#waiters.push(sessionId === undefined
        ? { method, resolve }
        : { method, resolve, sessionId });
    });
  }
}

const parseArgs = (): {
  readonly browserPath: string;
  readonly mode: Mode;
  readonly out: string;
  readonly settleMs: number;
  readonly url: string;
} => {
  const [modeArg = 'check', ...rawArgs] = process.argv.slice(2);
  const args = rawArgs.filter((arg) => arg !== '--');
  if (modeArg !== 'check' && modeArg !== 'profile') {
    throw new Error('Usage: node scripts/gpu.ts <check|profile> [--browser PATH] [--url URL] [--out trace.json]');
  }

  let browserPath = process.env.CHROMIUM_BIN ?? '/usr/bin/chromium';
  let out = path.join(tmpdir(), `royal-gpu-profile-${Date.now()}.json`);
  let settleMs = 0;
  let url = 'http://127.0.0.1:5173/cube';

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];

    if (arg === '--browser' && value !== undefined) {
      browserPath = value;
      index += 1;
      continue;
    }

    if (arg === '--url' && value !== undefined) {
      url = value;
      index += 1;
      continue;
    }

    if (arg === '--out' && value !== undefined) {
      out = value;
      index += 1;
      continue;
    }

    if (arg === '--settle-ms' && value !== undefined) {
      settleMs = Number(value);
      if (!Number.isFinite(settleMs) || settleMs < 0) {
        throw new Error(`Invalid --settle-ms value: ${value}`);
      }
      index += 1;
      continue;
    }

    throw new Error(`Unknown GPU script argument: ${arg ?? '<empty>'}`);
  }

  return { browserPath, mode: modeArg, out, settleMs, url };
};

const launchChromium = async (browserPath: string): Promise<{
  readonly browser: ChildProcessWithoutNullStreams;
  readonly userDataDir: string;
  readonly wsUrl: string;
}> => {
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'royal-gpu-'));
  const browser = spawn(browserPath, chromiumArgs(userDataDir));

  const wsUrl = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Chromium did not expose a DevTools websocket'));
    }, 10000);

    browser.stderr.on('data', (data: Buffer) => {
      const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/);
      if (match?.[1] === undefined) return;
      clearTimeout(timeout);
      resolve(match[1]);
    });

    browser.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chromium exited before profiling started: ${code}`));
    });
  });

  return { browser, userDataDir, wsUrl };
};

const openCdp = (wsUrl: string): Promise<CdpClient> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    socket.addEventListener('open', () => resolve(new CdpClient(socket)));
    socket.addEventListener('error', () => reject(new Error('Failed to connect to Chromium DevTools')));
  });

const openPage = async (
  cdp: CdpClient,
  url: string
): Promise<{ readonly sessionId: string }> => {
  const target = await cdp.send<{ readonly targetId: string }>('Target.createTarget', {
    url: 'about:blank'
  });
  const attached = await cdp.send<{ readonly sessionId: string }>('Target.attachToTarget', {
    flatten: true,
    targetId: target.targetId
  });
  const sessionId = attached.sessionId;

  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const started = performance.now();
      const stats = globalThis.__royalGpuActivity = { drawCalls: 0, firstDrawMs: null };
      const originalGetContext = HTMLCanvasElement.prototype.getContext;

      HTMLCanvasElement.prototype.getContext = function patchedGetContext(type, ...args) {
        const context = originalGetContext.call(this, type, ...args);
        if ((type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') && context && !context.__royalWrapped) {
          context.__royalWrapped = true;

          for (const name of ['drawArrays', 'drawElements']) {
            const original = context[name].bind(context);
            context[name] = (...drawArgs) => {
              stats.drawCalls += 1;
              stats.firstDrawMs ??= performance.now() - started;
              return original(...drawArgs);
            };
          }
        }
        return context;
      };
    })()`
  }, sessionId);
  const loaded = cdp.waitFor('Page.loadEventFired', sessionId);
  await cdp.send('Page.navigate', { url }, sessionId);
  await loaded;
  await cdp.send('Runtime.evaluate', {
    awaitPromise: true,
    expression: `new Promise((resolve, reject) => {
      const started = performance.now();
      const wait = () => {
        if (
          document.querySelector('canvas') !== null &&
          (globalThis.__royalGpuActivity?.drawCalls ?? 0) > 0
        ) {
          resolve(undefined);
          return;
        }
        if (performance.now() - started > 5000) {
          reject(new Error('Timed out waiting for canvas draw'));
          return;
        }
        setTimeout(wait, 16);
      };
      wait();
    })`
  }, sessionId);

  return { sessionId };
};

const readWebGl = async (cdp: CdpClient, sessionId: string): Promise<WebGlReport> => {
  const evaluated = await cdp.send<{
    readonly result: { readonly value?: BrowserWebGlReport };
  }>('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      const canvas = document.querySelector('canvas');
      const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      const pixels = gl && canvas ? new Uint8Array(canvas.width * canvas.height * 4) : null;
      if (gl && pixels) gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let differentPixels = 0;
      if (pixels) {
        for (let index = 4; index < pixels.length; index += 4) {
          if (
            pixels[index] !== pixels[0] ||
            pixels[index + 1] !== pixels[1] ||
            pixels[index + 2] !== pixels[2] ||
            pixels[index + 3] !== pixels[3]
          ) {
            differentPixels += 1;
          }
        }
      }
      const collectExtensionObject = (extension) => {
        if (extension === null || typeof extension !== 'object') return {};
        const constants = {};
        const keys = new Set();
        let target = extension;
        while (target !== null && target !== Object.prototype) {
          for (const key of Object.getOwnPropertyNames(target)) keys.add(key);
          target = Object.getPrototypeOf(target);
        }
        for (const key of keys) {
          if (!key.startsWith('COMPRESSED_')) continue;
          const value = extension[key];
          if (typeof value === 'number' && Number.isFinite(value)) constants[key] = value;
        }
        return constants;
      };
      const numberParameter = (parameter) => {
        if (!gl) return null;
        try {
          const value = gl.getParameter(parameter);
          return typeof value === 'number' && Number.isFinite(value) ? value : null;
        } catch {
          return null;
        }
      };
      const stringParameter = (parameter) => {
        if (!gl) return null;
        try {
          const value = gl.getParameter(parameter);
          return typeof value === 'string' ? value : null;
        } catch {
          return null;
        }
      };
      const extensionNames = gl?.getSupportedExtensions?.() ?? [];
      const extensionObjects = {};
      if (gl) {
        for (const name of extensionNames) {
          try {
            extensionObjects[name] = collectExtensionObject(gl.getExtension(name));
          } catch {
            extensionObjects[name] = {};
          }
        }
      }
      const compressedTextureFormats = gl
        ? Array.from(gl.getParameter(gl.COMPRESSED_TEXTURE_FORMATS) ?? [])
          .filter((value) => typeof value === 'number' && Number.isFinite(value))
        : [];
      const collectWebGpu = async () => {
        if (!('gpu' in navigator) || navigator.gpu === undefined) {
          return {
            reason: 'navigator.gpu unavailable in this runtime',
            status: 'unavailable'
          };
        }
        try {
          const adapter = await navigator.gpu.requestAdapter();
          if (adapter === null) {
            return {
              reason: 'navigator.gpu.requestAdapter returned null',
              status: 'unavailable'
            };
          }
          const limitNames = [
            'maxTextureDimension1D',
            'maxTextureDimension2D',
            'maxTextureDimension3D',
            'maxTextureArrayLayers',
            'maxBindGroups',
            'maxBindingsPerBindGroup',
            'maxSampledTexturesPerShaderStage',
            'maxSamplersPerShaderStage',
            'maxStorageBuffersPerShaderStage',
            'maxStorageTexturesPerShaderStage',
            'maxUniformBuffersPerShaderStage',
            'maxUniformBufferBindingSize',
            'maxStorageBufferBindingSize'
          ];
          const limits = {};
          for (const name of limitNames) {
            const value = adapter.limits?.[name];
            if (typeof value === 'number' && Number.isFinite(value)) limits[name] = value;
          }
          return {
            features: Array.from(adapter.features ?? []),
            limits,
            status: 'available'
          };
        } catch (error) {
          return {
            reason: error instanceof Error ? error.message : String(error),
            status: 'unavailable'
          };
        }
      };
      const isWebGl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
      const capabilitySnapshot = gl === null || gl === undefined ? null : {
        compressedTextureFormats,
        constants: {
          COMPRESSED_TEXTURE_FORMATS: gl.COMPRESSED_TEXTURE_FORMATS,
          MAX_COMBINED_TEXTURE_IMAGE_UNITS: gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS,
          MAX_TEXTURE_IMAGE_UNITS: gl.MAX_TEXTURE_IMAGE_UNITS,
          MAX_TEXTURE_SIZE: gl.MAX_TEXTURE_SIZE,
          READ_BUFFER: isWebGl2 ? gl.READ_BUFFER : undefined,
          RENDERER: gl.RENDERER,
          SHADING_LANGUAGE_VERSION: gl.SHADING_LANGUAGE_VERSION,
          TEXTURE_3D: isWebGl2 ? gl.TEXTURE_3D : undefined,
          VENDOR: gl.VENDOR,
          VERSION: gl.VERSION
        },
        extensionNames,
        extensionObjects,
        maxCombinedTextureImageUnits: numberParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
        maxTextureImageUnits: numberParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
        maxTextureSize: numberParameter(gl.MAX_TEXTURE_SIZE),
        renderer: stringParameter(gl.RENDERER),
        shadingLanguageVersion: stringParameter(gl.SHADING_LANGUAGE_VERSION),
        vendor: stringParameter(gl.VENDOR),
        version: isWebGl2 ? 2 : 1,
        versionLabel: stringParameter(gl.VERSION),
        webgpu: await collectWebGpu()
      };
      return {
        canvas: canvas === null ? null : { height: canvas.height, width: canvas.width },
        capabilitySnapshot,
        differentPixels,
        drawCalls: globalThis.__royalGpuActivity?.drawCalls ?? 0,
        firstDrawMs: globalThis.__royalGpuActivity?.firstDrawMs ?? null,
        renderer: gl && debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown',
        vendor: gl && debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : 'unknown'
      };
    })()`
  }, sessionId);

  if (evaluated.result.value === undefined) {
    throw new Error('Failed to read WebGL renderer');
  }

  const { capabilitySnapshot, ...report } = evaluated.result.value;
  return {
    ...report,
    capabilities: await collectCapabilities(capabilitySnapshot)
  };
};

const assertHardwareWebGl = (report: WebGlReport): void => {
  const renderer = report.renderer.toLowerCase();
  const vendor = report.vendor.toLowerCase();
  const software = ['swiftshader', 'software', 'llvmpipe', 'lavapipe'];

  if (report.canvas === null) throw new Error('No canvas found on page');
  if (report.drawCalls === 0) throw new Error('WebGL rendered no draw calls');
  if (software.some((needle) => renderer.includes(needle) || vendor.includes(needle))) {
    throw new Error(`Software WebGL renderer rejected: ${report.vendor} / ${report.renderer}`);
  }
};

const collectTrace = async (
  cdp: CdpClient,
  url: string,
  out: string,
  settleMs: number
): Promise<WebGlReport> => {
  const events: unknown[] = [];

  const onMessage = (event: MessageEvent): void => {
    const message = JSON.parse(String(event.data)) as CdpMessage;
    if (message.method !== 'Tracing.dataCollected') return;
    const params = message.params as { readonly value?: readonly unknown[] };
    events.push(...(params.value ?? []));
  };

  cdp.socket.addEventListener('message', onMessage);
  await cdp.send('Tracing.start', {
    categories: [
      'blink.user_timing',
      'cc',
      'devtools.timeline',
      'disabled-by-default-devtools.timeline',
      'gpu',
      'loading',
      'toplevel',
      'v8'
    ].join(','),
    transferMode: 'ReportEvents'
  });
  const page = await openPage(cdp, url);
  const report = await readWebGl(cdp, page.sessionId);
  if (settleMs > 0) {
    await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      expression: `new Promise((resolve) => setTimeout(resolve, ${JSON.stringify(settleMs)}))`
    }, page.sessionId);
  }
  const complete = cdp.waitFor('Tracing.tracingComplete');
  await cdp.send('Tracing.end');
  await complete;
  cdp.socket.removeEventListener('message', onMessage);

  writeFileSync(out, JSON.stringify({
    rendererCapabilityDiagnostics: report.capabilities.diagnostics,
    rendererCapabilityRows: report.capabilities.rows,
    traceEvents: events
  }));
  return report;
};

const loadCapabilityCollector = async (): Promise<
  (gl: WebGlLikeContext, options?: { readonly contextVersion?: 1 | 2; readonly webgpu?: WebGpuProbeInput }) => RendererCapabilityProbeResult
> => {
  const capabilityModulePath = '../packages/react-royal-fiber/src/webgl/webgl-capabilities.ts';
  const capabilities = await import(capabilityModulePath) as typeof import('../packages/react-royal-fiber/src/webgl/webgl-capabilities');
  return capabilities.collectRendererCapabilityRows;
};

const createCapabilityContext = (snapshot: BrowserCapabilitySnapshot): WebGlLikeContext => {
  const constants = snapshot.constants;

  return {
    ...constants,
    ...(snapshot.version === 2 ? { beginQuery: () => undefined } : {}),
    getExtension: (name) => snapshot.extensionObjects[name] ?? null,
    getParameter: (name) => {
      switch (name) {
        case constants.COMPRESSED_TEXTURE_FORMATS:
          return snapshot.compressedTextureFormats;
        case constants.MAX_COMBINED_TEXTURE_IMAGE_UNITS:
          return snapshot.maxCombinedTextureImageUnits ?? undefined;
        case constants.MAX_TEXTURE_IMAGE_UNITS:
          return snapshot.maxTextureImageUnits ?? undefined;
        case constants.MAX_TEXTURE_SIZE:
          return snapshot.maxTextureSize ?? undefined;
        case constants.RENDERER:
          return snapshot.renderer ?? undefined;
        case constants.SHADING_LANGUAGE_VERSION:
          return snapshot.shadingLanguageVersion ?? undefined;
        case constants.VENDOR:
          return snapshot.vendor ?? undefined;
        case constants.VERSION:
          return snapshot.versionLabel ?? undefined;
        default:
          return undefined;
      }
    },
    getSupportedExtensions: () => snapshot.extensionNames
  };
};

const collectCapabilities = async (
  snapshot: BrowserCapabilitySnapshot | null
): Promise<RendererCapabilityProbeResult> => {
  if (snapshot === null) return { diagnostics: [], rows: [] };

  const collectRendererCapabilityRows = await loadCapabilityCollector();
  return collectRendererCapabilityRows(createCapabilityContext(snapshot), {
    contextVersion: snapshot.version,
    webgpu: snapshot.webgpu
  });
};

const yesNo = (value: boolean): string => value ? 'yes' : 'no';

const isContextVersionRow = (row: RendererCapabilityProbeRow): row is ContextVersionRow =>
  row.kind === 'context_version';

const isTextureLimitRow = (row: RendererCapabilityProbeRow): row is TextureLimitRow =>
  row.kind === 'max_texture_size' || row.kind === 'max_texture_units';

const isRendererCapabilityRow = (row: RendererCapabilityProbeRow): row is RendererCapabilityRow =>
  row.kind === 'renderer_capability';

const isTimerQuerySupportRow = (row: RendererCapabilityProbeRow): row is GpuTimerQuerySupportRow =>
  row.kind === 'gpu_timer_query_support';

const isCompressedTextureFormatRow = (row: RendererCapabilityProbeRow): row is CompressedTextureFormatRow =>
  row.kind === 'compressed_texture_format';

const isWebGlExtensionRow = (row: RendererCapabilityProbeRow): row is WebGlExtensionRow =>
  row.kind === 'webgl_extension';

export const formatCapabilitySummary = (
  capabilities: RendererCapabilityProbeResult
): readonly string[] => {
  if (capabilities.rows.length === 0) {
    return ['Capabilities: unavailable (no WebGL context)'];
  }

  const context = capabilities.rows.find(isContextVersionRow);
  const textureLimits = capabilities.rows.filter(isTextureLimitRow);
  const textureSize = textureLimits.find((row) => row.kind === 'max_texture_size');
  const textureUnits = textureLimits.filter((row) => row.kind === 'max_texture_units');
  const gates = capabilities.rows.filter(isRendererCapabilityRow);
  const timerQuery = capabilities.rows.find(isTimerQuerySupportRow);
  const compressedFormats = capabilities.rows.filter(isCompressedTextureFormatRow);
  const extensionCount = capabilities.rows.filter(isWebGlExtensionRow).length;

  const contextLine = context === undefined
    ? 'Context: unknown'
    : [
      `Context: WebGL ${context.version}`,
      context.versionLabel === undefined ? undefined : `(${context.versionLabel})`,
      context.vendor === undefined ? undefined : `vendor=${context.vendor}`,
      context.renderer === undefined ? undefined : `renderer=${context.renderer}`
    ].filter((part) => part !== undefined).join(' ');
  const textureUnitSummary = textureUnits
    .map((row) => `${row.scope ?? 'unknown'}=${row.value}`)
    .join(', ');
  const textureLine = [
    'Texture limits:',
    textureSize === undefined ? 'max-size=unknown' : `max-size=${textureSize.value}`,
    textureUnitSummary.length === 0 ? 'units=unknown' : `units(${textureUnitSummary})`
  ].join(' ');
  const gateLine = `Capability gates: ${gates.map((row) => {
    const source = row.extension ?? row.source;
    return `${row.capability}=${yesNo(row.supported)}[${source}]`;
  }).join(', ')}`;
  const timerLine = timerQuery === undefined
    ? 'Timer query: unknown'
    : `Timer query: ${yesNo(timerQuery.supported)}[${timerQuery.queryApi}${timerQuery.extension === undefined ? '' : `:${timerQuery.extension}`}]`;
  const compressedLine = compressedFormats.length === 0
    ? 'Compressed texture formats: none'
    : `Compressed texture formats: ${compressedFormats.slice(0, 24).map((row) =>
      `${row.family}:${row.format}`
    ).join(', ')}${compressedFormats.length > 24 ? `, +${compressedFormats.length - 24} more` : ''}`;
  const diagnostics = capabilities.diagnostics
    .map((diagnostic) => diagnostic.key ?? diagnostic.code)
    .join(', ');

  return [
    contextLine,
    textureLine,
    gateLine,
    timerLine,
    compressedLine,
    `WebGL extensions: ${extensionCount}`,
    `Capability diagnostics: ${diagnostics.length === 0 ? 'none' : diagnostics}`
  ];
};

const main = async (): Promise<void> => {
  const { browserPath, mode, out, settleMs, url } = parseArgs();
  const { browser, userDataDir, wsUrl } = await launchChromium(browserPath);

  try {
    const cdp = await openCdp(wsUrl);
    const report = mode === 'profile'
      ? await collectTrace(cdp, url, out, settleMs)
      : await checkPage(cdp, url, settleMs);

    assertHardwareWebGl(report);
    console.log(`WebGL renderer: ${report.vendor} / ${report.renderer}`);
    console.log(`Canvas: ${report.canvas?.width}x${report.canvas?.height}`);
    console.log(`Draw calls: ${report.drawCalls}`);
    console.log(`First draw: ${report.firstDrawMs?.toFixed(2) ?? 'unknown'} ms`);
    for (const line of formatCapabilitySummary(report.capabilities)) {
      console.log(line);
    }

    if (mode === 'profile') {
      console.log(`Trace: ${out}`);
    }

    cdp.socket.close();
  } finally {
    browser.kill();
    rmSync(userDataDir, { force: true, recursive: true });
  }
};

const isMain = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  await main();
}

async function checkPage(cdp: CdpClient, url: string, settleMs: number): Promise<WebGlReport> {
  const page = await openPage(cdp, url);

  if (settleMs > 0) {
    await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      expression: `new Promise((resolve) => setTimeout(resolve, ${JSON.stringify(settleMs)}))`
    }, page.sessionId);
  }

  return await readWebGl(cdp, page.sessionId);
}
