import { defineConfig, type Plugin } from 'vite';

/**
 * Offline support for the installed app: writes sw.js into the build with every
 * emitted file (and the public/ files the manifest uses) in its precache list,
 * and a cache name unique to the build so a new build replaces the old cache.
 */
function serviceWorker(): Plugin {
  return {
    name: 'rdui-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', ...Object.keys(bundle)];
      const source = `// Generated at build time (vite.config.ts): precache the whole app so it runs offline.
const CACHE = 'rdui-${Date.now().toString(36)}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // pages: the network first (so a reachable server brings updates), else the cache;
  // everything else has hashed names, so the cache first. ignoreVary: servers send
  // 'Vary: Origin', and module scripts carry an Origin header the precache didn't.
  const opts = { ignoreVary: true, ignoreSearch: true };
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./', opts)));
    return;
  }
  e.respondWith(caches.match(req, opts).then((hit) => hit || fetch(req)));
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({ plugins: [serviceWorker()] });
