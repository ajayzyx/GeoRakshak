// Metro configuration. Native uses the Expo defaults; the two additions below are
// what expo-sqlite needs on web (the browser presentation path, see README):
// its wa-sqlite WebAssembly file must be treated as an asset, and OPFS needs the
// cross-origin isolation headers on the dev server.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => (req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    return middleware(req, res, next);
  },
};

module.exports = config;
