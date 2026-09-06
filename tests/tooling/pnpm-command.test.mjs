import { expect, it } from 'vitest';
import { pnpmCommand } from '../../scripts/pnpm-command.mjs';

it('executes native pnpm directly, preserving arguments with spaces', () => {
  expect(pnpmCommand('/tools/pnpm native/pnpm', '/tools/node', ['--dir', '/project with spaces', 'pack']))
    .toEqual({ command: '/tools/pnpm native/pnpm', args: ['--dir', '/project with spaces', 'pack'] });
});
it.each(['pnpm.cjs', 'pnpm.mjs', 'pnpm.js'])('runs the JavaScript CLI %s through Node', (cli) => {
  expect(pnpmCommand(cli, '/tools/node', ['pack']))
    .toEqual({ command: '/tools/node', args: [cli, 'pack'] });
});
it('uses PATH when no package-manager executable was supplied', () => {
  expect(pnpmCommand(undefined, '/tools/node', ['pack']))
    .toEqual({ command: 'pnpm', args: ['pack'] });
});
