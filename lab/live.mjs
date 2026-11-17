// The live viewer: a page showing the lab's current experiment as it runs (node lab/live.mjs, then open
// http://127.0.0.1:5190). Shows the latest snapshot large, the last few beside it, and the run's log; refreshes itself.
// It reads lab/out/_live/, which lab/run.mjs writes.
import http from 'http';
import fs from 'fs';
import path from 'path';

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'out', '_live');
const port = Number(process.env.PORT ?? 5190);
const page = `<!doctype html><meta charset="utf-8"><title>rdui lab: live</title>
<style>
  body { margin: 0; background: #0d0f14; color: #d8dce6; font: 13px ui-monospace, monospace; display: grid;
    grid-template-columns: minmax(0, 1fr) 380px; height: 100vh; }
  main { display: flex; flex-direction: column; padding: 12px; gap: 8px; min-width: 0; }
  #head { color: #ffcc66; } #cfg { color: #8a93a6; word-break: break-all; }
  #big { flex: 1; min-height: 0; object-fit: contain; image-rendering: pixelated; background: #000; width: 100%; }
  #strip { display: flex; gap: 6px; height: 110px; } #strip img { height: 100%; image-rendering: pixelated; opacity: .8 }
  aside { border-left: 1px solid #222838; padding: 12px; overflow: auto; white-space: pre-wrap; }
</style>
<main><div id="head">waiting for an experiment…</div><div id="cfg"></div><img id="big"><div id="strip"></div></main>
<aside id="log"></aside>
<script>
let seen = -1;
async function tick() {
  try {
    const run = await (await fetch('/run.json', { cache: 'no-store' })).json();
    document.getElementById('head').textContent = run.exp + (run.caption ? '  ·  ' + run.caption : '') + '  ·  ' + Math.round((Date.now() - run.started) / 1000) + ' s';
    document.getElementById('cfg').textContent = run.cfg;
    if (run.frames !== seen && run.last) {
      seen = run.frames;
      document.getElementById('big').src = '/' + run.last + '?' + run.frames;
      const strip = document.getElementById('strip'); strip.innerHTML = '';
      for (let k = 1; k <= Math.min(7, run.frames - 1); k++) {
        const img = document.createElement('img'); img.src = '/frame-' + ((run.frames - 1 - k) % 8) + '.png?' + run.frames; strip.append(img);
      }
    }
    const log = await (await fetch('/log.txt', { cache: 'no-store' })).text();
    const el = document.getElementById('log'); const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    el.textContent = log; if (atEnd) el.scrollTop = el.scrollHeight;
  } catch {}
  setTimeout(tick, 700);
}
tick();
</script>`;

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(page); }
  const f = path.join(dir, path.basename(url.pathname));
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const type = f.endsWith('.png') ? 'image/png' : f.endsWith('.json') ? 'application/json' : 'text/plain';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`live viewer: http://127.0.0.1:${port}`));
