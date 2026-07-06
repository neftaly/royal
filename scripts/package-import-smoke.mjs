import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const packages = [
  {
    cwd: 'packages/renderer-core',
    specifiers: [
      '@royal/renderer-core',
      '@royal/renderer-core/render-object',
      '@royal/renderer-core/text',
      '@royal/renderer-core/text/editable',
      '@royal/renderer-core/text/font',
      '@royal/renderer-core/text/layout',
      '@royal/renderer-core/text/mesh',
      '@royal/renderer-core/text/node',
      '@royal/renderer-core/text/shaping',
      '@royal/renderer-core/text/types'
    ]
  },
  {
    cwd: 'packages/renderer-webgl',
    specifiers: [
      '@royal/renderer-webgl',
      '@royal/renderer-webgl/capabilities',
      '@royal/renderer-webgl/webxr'
    ]
  },
  {
    cwd: 'packages/react',
    specifiers: [
      '@royal/react',
      '@royal/react/scene',
      '@royal/react/xr',
      '@royal/react/jsx-runtime',
      '@royal/react/jsx-dev-runtime',
      '@royal/react/renderer/jsx-runtime',
      '@royal/react/renderer/jsx-dev-runtime'
    ]
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
