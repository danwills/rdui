// A little page for reviewing a folder of clips: each video with playback speed and crisp zoom, a description, yes /
// no / maybe and a note, saved as you click to picks.json in the folder (so Claude can read them back), and 🎲 colours
// / 🌱 seed / 🌑 too dark / ☀️ too bright re-rolls (ticked, then request new), queued in rerolls.json for lab/clip-reroll.mjs.
//   node lab/clip-review.mjs [folder, default ~/Videos/rdui-examples] [port, default 5180]
// Descriptions come from notes.json in the folder ({"file.mp4": "what it shows"}), if there is one.
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';

const dir = path.resolve(process.argv[2] ?? path.join(os.homedir(), 'Videos', 'rdui-examples'));
const port = Number(process.argv[3] ?? 5180);
const picksFile = path.join(dir, 'picks.json');
const rerollsFile = path.join(dir, 'rerolls.json');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>rdui clips</title><style>
:root { --bg: #08090c; --panel: #11141a; --line: #222834; --text: #c9d1dd; --muted: #6c7789; --accent: #ffcc66; --btn: #1a1f28;
  --yes: #4caf73; --no: #d9534f; --maybe: #e0a83a; color-scheme: dark; font: 14px/1.4 ui-sans-serif, system-ui, sans-serif; }
body { margin: 0; background: var(--bg); color: var(--text); }
header { position: sticky; top: 0; z-index: 2; background: var(--panel); border-bottom: 1px solid var(--line); padding: 10px 16px;
  display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
h1 { font-size: 18px; margin: 0; color: var(--accent); letter-spacing: 0.04em; }
.sub { color: var(--muted); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 12px; padding: 12px; }
@media (min-width: 960px) { .grid { grid-template-columns: repeat(3, 1fr); } }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; }
.card.yes { border-color: var(--yes); } .card.no { border-color: var(--no); opacity: 0.6; } .card.maybe { border-color: var(--maybe); }
.frame { background: #000; overflow: auto; max-height: 70vh; display: flex; }
.frame.zoomed { display: block; }
video { width: 100%; height: auto; display: block; image-rendering: pixelated; margin: auto; }
.meta { padding: 8px 10px 0; }
.name { font-weight: 600; } .desc { color: var(--muted); margin-top: 2px; }
.row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px 10px; }
.row .label { color: var(--muted); font-size: 12px; margin-right: 2px; }
button { font: inherit; color: var(--text); background: var(--btn); border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
button.on { border-color: var(--accent); color: var(--accent); }
button:disabled { opacity: 0.4; cursor: default; }
button.pick.yes.on { background: var(--yes); border-color: var(--yes); color: #fff; }
button.pick.no.on { background: var(--no); border-color: var(--no); color: #fff; }
button.pick.maybe.on { background: var(--maybe); border-color: var(--maybe); color: #111; }
input.note { flex: 1; min-width: 120px; font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; }
.saved { color: var(--muted); font-size: 12px; }
details.done > summary { cursor: pointer; padding: 10px 16px; color: var(--muted); font-weight: 600; border-top: 1px solid var(--line); }
</style></head><body>
<header><h1>rdui clips</h1><span class="sub" id="count"></span><span class="sub">Your picks save as you click.</span>
<span class="row" style="padding:0"><span class="label">all at</span><button data-all="1">1×</button><button data-all="2">2×</button><button data-all="4">4×</button></span>
<span class="saved" id="saved"></span></header>
<main id="grid" class="grid"></main>
<details class="done" id="queued-box"><summary></summary><div class="grid" id="queued-grid"></div></details>
<details class="done" id="maybe-box"><summary></summary><div class="grid" id="maybe-grid"></div></details>
<details class="done" id="yes-box"><summary></summary><div class="grid" id="yes-grid"></div></details>
<details class="done" id="no-box"><summary></summary><div class="grid" id="no-grid"></div></details>
<script>
const $ = (t, a = {}, ...kids) => { const e = document.createElement(t); for (const [k, v] of Object.entries(a)) k.startsWith('on') ? e.addEventListener(k.slice(2), v) : e.setAttribute(k, v); e.append(...kids); return e; };
let picks = {};
async function save() {
  const r = await fetch('picks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(picks) });
  document.getElementById('saved').textContent = r.ok ? 'saved ' + new Date().toLocaleTimeString() : 'not saved!';
}
const rates = [];
// clips waiting on a re-roll and picked ones go out of the way, into folded sections at the bottom (queued, maybe, yes, no),
// leaving the main grid to those still needing a decision
const picks3 = ['queued', 'maybe', 'yes', 'no'];
const place = (card, k) => {
  document.getElementById(picks3.includes(k) ? k + '-grid' : 'grid').append(card);
  for (const s of picks3) {
    const n = document.getElementById(s + '-grid').children.length, box = document.getElementById(s + '-box');
    box.hidden = !n; box.querySelector('summary').textContent = s + ' (' + n + ')';
  }
};
for (const s of picks3) {
  const box = document.getElementById(s + '-box');
  box.open = sessionStorage.getItem(s + '-open') === '1';
  box.addEventListener('toggle', () => sessionStorage.setItem(s + '-open', box.open ? '1' : ''));
}
(async () => {
  const [{ files, notes, rerolls }, p] = await Promise.all([fetch('list').then((r) => r.json()), fetch('picks').then((r) => r.json())]);
  picks = p;
  document.getElementById('count').textContent = files.length + ' clips';
  for (const f of files) {
    const v = $('video', { src: encodeURIComponent(f.name) + '?v=' + f.mtime, controls: '', loop: '', muted: '', playsinline: '', preload: 'metadata' });
    v.muted = true;
    const frame = $('div', { class: 'frame' }, v);
    const card = $('article', { class: 'card ' + (picks[f.name]?.pick ?? '') });
    const setRate = (x) => { v.playbackRate = x; speed.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.r === x)); };
    rates.push(setRate);
    const speed = $('span', { class: 'row', style: 'padding:0' }, $('span', { class: 'label' }, 'speed'),
      ...[0.5, 1, 2, 4].map((x) => $('button', { 'data-r': x, onclick: () => setRate(x) }, x + '×')));
    const setZoom = (z) => {
      frame.classList.toggle('zoomed', z > 1);
      v.style.width = z > 1 ? (v.videoWidth * z / devicePixelRatio) + 'px' : '100%';
      zoom.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.z === z));
    };
    const zoom = $('span', { class: 'row', style: 'padding:0' }, $('span', { class: 'label' }, 'zoom'),
      ...[[1, 'fit'], [2, '2×'], [4, '4×']].map(([z, t]) => $('button', { 'data-z': z, onclick: () => setZoom(z) }, t)));
    const pick = (k) => {
      picks[f.name] = { ...picks[f.name], pick: picks[f.name]?.pick === k ? undefined : k };
      card.className = 'card ' + (picks[f.name].pick ?? '');
      pickRow.querySelectorAll('.pick').forEach((b) => b.classList.toggle('on', b.dataset.k === picks[f.name].pick));
      place(card, waiting ? 'queued' : picks[f.name].pick);
      save();
    };
    const pickRow = $('div', { class: 'row' }, ...['yes', 'maybe', 'no'].map((k) => $('button', { class: 'pick ' + k + (picks[f.name]?.pick === k ? ' on' : ''), 'data-k': k, onclick: () => pick(k) }, k)));
    const note = $('input', { class: 'note', placeholder: 'note (optional)', value: picks[f.name]?.note ?? '' });
    let t; note.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { picks[f.name] = { ...picks[f.name], note: note.value }; save(); }, 500); });
    pickRow.append(note);
    // re-rolls: queued here, done by lab/clip-reroll.mjs (the clip is replaced; the page reloads when it is)
    const mine = rerolls.filter((j) => j.name === f.name && j.state !== 'done');
    let waiting = mine.some((j) => j.state === 'queued' || j.state === 'recording');
    // what to change: toggled, then asked for together with request new
    const icons = { colour: '🎲', seed: '🌱', dark: '🌑', bright: '☀️' };
    const kindsOf = (j) => j.kinds ?? [j.kind];
    const state = $('span', { class: 'saved' }, mine.map((j) => kindsOf(j).map((k) => icons[k]).join('') + ' ' + j.state + (j.why ? ' (' + j.why + ')' : '')).join(' · '));
    const chosen = new Set();
    const toggle = (k) => (e) => { chosen.has(k) ? chosen.delete(k) : chosen.add(k); e.currentTarget.classList.toggle('on', chosen.has(k)); go.disabled = !chosen.size; };
    const go = $('button', { title: 'record this clip again with the changes ticked', onclick: () => {
      const kinds = [...chosen];
      fetch('reroll', { method: 'POST', body: JSON.stringify({ name: f.name, kinds }) }).then((r) => {
        state.textContent = (state.textContent ? state.textContent + ' · ' : '') + kinds.map((k) => icons[k]).join('') + ' ' + (r.ok ? 'queued' : 'not queued!');
        if (r.ok) { waiting = true; place(card, 'queued'); }
      });
    } }, 'request new');
    go.disabled = true;
    const rerollRow = $('div', { class: 'row' }, $('span', { class: 'label' }, 're-roll'),
      $('button', { title: 'new 🎲 colours, different from these', onclick: toggle('colour') }, '🎲 colours'),
      $('button', { title: 'a different start (rules that seed at random), keeping the colours unless 🎲 is ticked too', onclick: toggle('seed') }, '🌱 seed'),
      $('button', { title: 'too dark: new colours, rolled till clearly brighter than these', onclick: toggle('dark') }, '🌑 too dark'),
      $('button', { title: 'too bright: new colours, rolled till clearly dimmer than these', onclick: toggle('bright') }, '☀️ too bright'),
      go, state);
    card.append(frame, $('div', { class: 'meta' }, $('div', { class: 'name' }, f.name), $('div', { class: 'desc' }, notes[f.name] ?? (f.size / 1e6).toFixed(1) + ' MB')),
      $('div', { class: 'row' }, speed, zoom), pickRow, rerollRow);
    place(card, waiting ? 'queued' : picks[f.name]?.pick);
    setRate(1); setZoom(1);
    v.addEventListener('loadedmetadata', () => v.playbackRate = +speed.querySelector('.on').dataset.r);
  }
  // reload when a clip or a description is added or changed (keeping the scroll position), unless a note is being typed
  const sig = (d) => JSON.stringify([d.files.map((f) => [f.name, f.mtime]), d.notes, d.rerolls.map((j) => j.state)]);
  const was = sig({ files, notes, rerolls });
  setInterval(async () => {
    const d = await fetch('list').then((r) => r.json()).catch(() => null);
    if (!d || sig(d) === was || document.activeElement?.classList.contains('note')) return;
    sessionStorage.setItem('scroll', String(scrollY));
    location.reload();
  }, 10000);
  const sy = Number(sessionStorage.getItem('scroll')); if (sy) requestAnimationFrame(() => scrollTo(0, sy));
  document.querySelectorAll('[data-all]').forEach((b) => b.addEventListener('click', () => rates.forEach((s) => s(+b.dataset.all))));
  // play only what's on screen (a dozen 1024² videos at once is a lot)
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting ? e.target.play().catch(() => {}) : e.target.pause()), { threshold: 0.3 });
  document.querySelectorAll('video').forEach((v) => io.observe(v));
})();
</script></body></html>`;

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(page);
  if (url === '/list') {
    const files = fs.readdirSync(dir).filter((f) => /^[^.].*\.(mp4|webm)$/i.test(f)).sort().map((name) => { const st = fs.statSync(path.join(dir, name)); return { name, size: st.size, mtime: Math.round(st.mtimeMs) }; });
    return res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ files, notes: readJson(path.join(dir, 'notes.json'), {}), rerolls: readJson(rerollsFile, []) }));
  }
  // a re-roll asked for (kinds: colour, seed, dark, bright), queued for lab/clip-reroll.mjs
  if (url === '/reroll' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const { name, kinds } = JSON.parse(body);
        if (!kinds?.length || !kinds.every((k) => ['colour', 'seed', 'dark', 'bright'].includes(k)) || !fs.existsSync(path.join(dir, path.basename(name)))) throw new Error('bad re-roll');
        const q = readJson(rerollsFile, []);
        q.push({ name: path.basename(name), kinds, at: Date.now(), state: 'queued' });
        fs.writeFileSync(rerollsFile, JSON.stringify(q, null, 1));
        res.writeHead(204).end();
      } catch (e) { res.writeHead(400).end(String(e)); }
    });
    return;
  }
  if (url === '/picks' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try { fs.writeFileSync(picksFile, JSON.stringify(JSON.parse(body), null, 1)); res.writeHead(204).end(); } catch (e) { res.writeHead(400).end(String(e)); }
    });
    return;
  }
  if (url === '/picks') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(readJson(picksFile, {})));
  // the clips themselves, with byte ranges (so the browser can seek)
  const file = path.join(dir, path.basename(url));
  if (!/\.(mp4|webm)$/i.test(file) || !fs.existsSync(file)) return res.writeHead(404).end();
  const size = fs.statSync(file).size, type = file.endsWith('.webm') ? 'video/webm' : 'video/mp4';
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (!m) return fs.createReadStream(file).pipe(res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' }));
  const start = m[1] ? +m[1] : size - +m[2], end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
  fs.createReadStream(file, { start, end }).pipe(res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes' }));
}).listen(port, '127.0.0.1', () => console.log(`clips from ${dir} at http://127.0.0.1:${port}/`));
