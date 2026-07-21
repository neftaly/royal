const entrypoints = [
  '@royal/renderer-core',
  '@royal/renderer-core/render-object',
  '@royal/renderer-webgl',
  '@royal/renderer-webgl/xr',
  '@royal/react',
  '@royal/react/scene',
  '@royal/react/xr',
];

for (const entrypoint of entrypoints) await import(entrypoint);
console.log('ok packed Royal entrypoints');
