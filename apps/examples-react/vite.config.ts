import path from 'node:path';
import { mergeConfig, type ConfigEnv, type UserConfig } from 'vite';
import rootConfig from '../../vite.config';

const appRoot = path.dirname(new URL(import.meta.url).pathname);

export default async (env: ConfigEnv): Promise<UserConfig> => {
  const baseConfig =
    typeof rootConfig === 'function' ? await rootConfig(env) : rootConfig;

  return mergeConfig(baseConfig, {
    publicDir: path.join(appRoot, 'public'),
  });
};
