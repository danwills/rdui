import { readFileSync } from 'fs';
import { defineConfig, type Plugin } from 'vite';

/**
 * Offline support for the installed app: writes sw.js into the build with every
 * emitted file (and the public/ files the manifest uses) in its precache list,
 * and a cache name unique to the build so a new build replaces the old cache.
 */
function serviceWorker(icons: string[]): Plugin {
  return {
    name: 'rdui-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      // (no repeats: addAll rejects a list with the same request twice, and the new service worker never installs)
      const files = [...new Set(['./', 'manifest.webmanifest', ...icons, ...Object.keys(bundle)])];
      const source = `// Generated at build time (vite.config.ts): precache the whole app so it runs offline.
const CACHE = 'rdui-${Date.now().toString(36)}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache, so the precache is this build's files
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // pages, the manifest and the icons: the network first (so a reachable server brings updates,
  // and installing reads this build's name and icons), else the cache; everything else has
  // hashed names, so the cache first. ignoreVary: servers send
  // 'Vary: Origin', and module scripts carry an Origin header the precache didn't.
  const opts = { ignoreVary: true, ignoreSearch: true };
  const path = new URL(req.url).pathname;
  if (req.mode === 'navigate' || path.endsWith('/manifest.webmanifest') || /[/]icon[-a-z0-9]*[.]png$/.test(path)) {
    e.respondWith(fetch(req).catch(() => caches.match(req.mode === 'navigate' ? './' : req, opts)));
    return;
  }
  e.respondWith(caches.match(req, opts).then((hit) => hit || fetch(req)));
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

/**
 * Two builds, so both can be installed side by side and told apart on a home screen: the local
 * one (npm run build -> dist/, served by vite preview to the phone over adb) is "rdui dev" with
 * the DEV-badged icons (lab/make-dev-icon.mjs); the cloud one (npm run deploy -> dist-cloud/,
 * https://rdui.rdui.workers.dev) is plain rdui. The manifest (from ./app-manifest.json: not the name index.html links, or Vite would bundle it as an asset) is written
 * per build.
 */
function appIdentity(cloud: boolean): Plugin {
  const icon = (size: number) => (cloud ? `icon-${size}.png` : `icon-dev-${size}.png`);
  return {
    name: 'rdui-app-identity',
    transformIndexHtml: (html) => html.replace('href="/icon-192.png"', `href="/${icon(192)}"`),
    generateBundle() {
      const m = JSON.parse(readFileSync('app-manifest.json', 'utf8'));
      if (!cloud) Object.assign(m, { name: `${m.short_name} dev — ${m.name.split(' — ')[1]}`, short_name: `${m.short_name} dev` });
      m.icons = [192, 512].map((s) => ({ src: icon(s), sizes: `${s}x${s}`, type: 'image/png', purpose: 'any maskable' }));
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(m, null, 2) });
    },
  };
}

// shown in the panel header, so it's easy to see which version the installed app runs
const now = new Date();
const build = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

export default defineConfig(({ mode, command }) => {
  const cloud = mode === 'cloud';
  return {
    plugins: [
      // (the dev server keeps serving index.html as is: the plain icon, and no manifest)
      ...(command === 'build' ? [appIdentity(cloud)] : []),
      serviceWorker(cloud ? ['icon-192.png', 'icon-512.png'] : ['icon-dev-192.png', 'icon-dev-512.png']),
    ],
    build: { outDir: cloud ? 'dist-cloud' : 'dist' },
    define: { __BUILD__: JSON.stringify(process.env.NODE_ENV === 'production' ? `build ${build}` : 'dev') },
  };
});
