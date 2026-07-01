import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeConfig, type ConfigEnv, type UserConfig } from 'vite';
import rootConfig from '../../vite.config';

const appRoot = fileURLToPath(new URL('.', import.meta.url));

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
  });
};
