import { mergeConfig, type ConfigEnv, type UserConfig } from 'vite';
import rootConfig from '../../vite.config';

export default (env: ConfigEnv): UserConfig => {
  const baseConfig =
    typeof rootConfig === 'function' ? rootConfig(env) : rootConfig;

  return mergeConfig(baseConfig, {
    build: {
      sourcemap: false,
      rollupOptions: {
        checks: { pluginTimings: false },
      },
    },
    publicDir: 'public',
  });
};
