/** npm_execpath can name a JavaScript CLI or pnpm's native executable. */
export const pnpmCommand = (cli, node, args) => /\.(?:c|m)?js$/iu.test(cli ?? '')
  ? { command: node, args: [cli, ...args] }
  : { command: cli ?? 'pnpm', args };
