import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeConfig, type ConfigEnv, type UserConfig } from 'vite';
import rootConfig from '../../vite.config';

const appRoot = fileURLToPath(new URL('.', import.meta.url));
const flexilyBrowserAliases = [
  {
    find: 'node:fs',
    replacement: path.join(appRoot, 'src/shims/flexily-node-fs.ts'),
  },
  {
    find: 'node:module',
    replacement: path.join(appRoot, 'src/shims/flexily-node-module.ts'),
  },
];

export default (env: ConfigEnv): UserConfig => {
  const baseConfig =
    typeof rootConfig === 'function' ? rootConfig(env) : rootConfig;

  return mergeConfig(baseConfig, {
    build: {
      rollupOptions: {
        checks: { pluginTimings: false },
      },
    },
    publicDir: path.join(appRoot, 'public'),
    resolve: {
      alias: flexilyBrowserAliases,
    },
  });
};
