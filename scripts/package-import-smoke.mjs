import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const packages = [
  {
    cwd: 'packages/renderer-core',
    specifiers: [
      '@royal/renderer-core',
      '@royal/renderer-core/render-object'
    ]
  },
  {
    cwd: 'packages/renderer-webgl',
    specifiers: ['@royal/renderer-webgl']
  },
  {
    cwd: 'packages/react',
    specifiers: ['@royal/react', '@royal/react/scene']
  }
];

for (const packageCheck of packages) {
  const cwd = path.join(repoRoot, packageCheck.cwd);
  const script = `
    for (const specifier of ${JSON.stringify(packageCheck.specifiers)}) {
      await import(specifier);
      console.log('ok', specifier);
    }
    await import(${JSON.stringify(packageCheck.specifiers[0] + '/package.json')}, {
      with: { type: 'json' }
    });
    console.log('ok', ${JSON.stringify(packageCheck.specifiers[0] + '/package.json')});
  `;

  execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd,
    stdio: 'inherit'
  });
}
