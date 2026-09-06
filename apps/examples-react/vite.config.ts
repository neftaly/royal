import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeConfig, type ConfigEnv, type Plugin, type UserConfig } from 'vite';
import rootConfig from '../../vite.config.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const gitOutput = (args: readonly string[]): string | undefined => {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : undefined;
};

const examplesSource = () => {
  const builtAt = new Date().toISOString();
  const revision = process.env.ROYAL_SOURCE_REVISION
    ?? gitOutput(['rev-parse', 'HEAD'])
    ?? 'unknown';
  const dirty = process.env.ROYAL_SOURCE_DIRTY === undefined
    ? (gitOutput(['status', '--porcelain', '--untracked-files=normal']) ?? '') !== ''
    : process.env.ROYAL_SOURCE_DIRTY === '1';
  return {
    buildId: process.env.ROYAL_EXAMPLES_BUILD_ID
      ?? `${revision.slice(0, 12)}-${dirty ? 'dirty' : 'clean'}-${Date.now().toString(36)}`,
    builtAt,
    dirty,
    revision,
  };
};

const sourceIdentityPlugin = (source: ReturnType<typeof examplesSource>): Plugin => {
  const body = `${JSON.stringify(source)}\n`;
  const serve = (request: { url?: string }, response: {
    end: (body: string) => void;
    setHeader: (name: string, value: string) => void;
  }, next: () => void): void => {
    if (request.url?.split('?', 1)[0] !== '/__royal-source.json') {
      next();
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(body);
  };
  return {
    name: 'royal-examples-source-identity',
    configureServer: (server) => { server.middlewares.use(serve); },
    generateBundle() {
      this.emitFile({ fileName: '__royal-source.json', source: body, type: 'asset' });
    },
  };
};

export default (env: ConfigEnv): UserConfig => {
  const baseConfig =
    typeof rootConfig === 'function' ? rootConfig(env) : rootConfig;
  const source = examplesSource();

  return mergeConfig(baseConfig, {
    build: {
      sourcemap: process.env.EXAMPLES_PROFILE_SOURCEMAPS === '1' ? 'hidden' : false,
      rollupOptions: {
        checks: { pluginTimings: false },
      },
    },
    define: {
      __ROYAL_EXAMPLES_SOURCE__: JSON.stringify(source),
    },
    plugins: [sourceIdentityPlugin(source)],
    publicDir: 'public',
  });
};
