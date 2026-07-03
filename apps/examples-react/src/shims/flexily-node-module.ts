type BrowserRequire = (id: string) => unknown;

const format = (...values: readonly unknown[]): string =>
  values.map((value) =>
    typeof value === 'string'
      ? value
      : value instanceof Error
        ? value.stack ?? value.message
        : JSON.stringify(value)
  ).join(' ');

const modules: Record<string, unknown> = {
  os: {
    EOL: '\n',
    homedir: () => '/',
    hostname: () => 'browser',
    platform: () => 'browser',
    release: () => '',
    tmpdir: () => '/tmp',
    type: () => 'Browser',
  },
  tty: {
    isatty: () => false,
  },
  util: {
    format,
    inspect: (value: unknown) => format(value),
  },
};

export const createRequire = (): BrowserRequire =>
  (id: string): unknown => {
    const mod = modules[id];
    if (mod === undefined) throw new Error(`Unsupported browser module shim: ${id}`);
    return mod;
  };
