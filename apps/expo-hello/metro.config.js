const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const tarstateCoreSourceRoot = path.resolve(__dirname, '../../packages/tarstate-core/src');

function isInTarstateCoreSource(filePath) {
  const relativePath = path.relative(tarstateCoreSourceRoot, filePath);

  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js') &&
    isInTarstateCoreSource(context.originModulePath)
  ) {
    return context.resolveRequest(context, `${moduleName.slice(0, -3)}.ts`, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
