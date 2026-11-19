// Records a clip from the real app, headless, with its own Record panel, so the video looks exactly as the app shows
// it (the rule's or scene's view, palette and all):
//   node lab/record-app.mjs <rule id> <out.mp4> ['{"seconds":15,"fps":60,"steps":0,"scale":2,"quality":"high","warm":0,"size":0,"palette":"","dice":0,"set":{},"preset":""}']
// <rule id> is as the Rules menu has it: scene:<file name>, builtin:<n>, pattern:<name>. steps 0 keeps the sim's own
// steps/frame; scale 0.5, 1, 2 or 4 (times the grid); quality light, good or high; warm: sim steps to run before
// recording (the main loop runs them, so it's rough); size: the grid (0 keeps the rule's or scene's own); palette: a
// palette by name (applied after dice); preset: an F/k preset by name (coral, maze...) as the field's background; set: parameters by name
// ({"D_a":0.2}); dice: press 🎲 that many times for new custom colours (random, so each run differs), with every reagent
// switched on (channels: 'shown' leaves them), after diceWarm seconds (default 6) so they fit a grown pattern, rolled again
// till a probe's brightness reaches bright (default 32 of 255, at most tries times, default 20); blend: seconds to wait
// for them, default 4; restart: false records on from the grown field instead of starting over; look: a palette saved in
// a recipe, put back instead of rolling (the recipe, .recipes/<out>.json beside the clip, is written for every take);
// liveSteps: the live loop's steps/frame before recording (heavy scenes lose the GPU device headless at their own).
// Clips start at the very start (the sim paused through the restart). fit: true slows a pattern that settles early, so
// its growth fills the clip; erase paints soft erase strokes while recording; drop adds solitons to a ring track (see
// below for each).
// Starts its own vite server, like run.mjs; prints the saved file's size and the panel's status line.
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { createServer } from 'vite';
import { execFileSync } from 'child_process';

const [id, out, cfgText = '{}'] = process.argv.slice(2);
if (!id || !out) throw new Error('usage: node lab/record-app.mjs <rule id> <out.mp4> [config]');
const cfg = { seconds: 15, fps: 60, steps: 0, scale: 2, quality: 'high', warm: 0, size: 0, ...JSON.parse(cfgText) };
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dlDir = fs.mkdtempSync(path.join(root, 'lab', 'out', 'rec-'));
const server = await createServer({ root, logLevel: 'error', server: { port: 0, hmr: false, watch: null } });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome-stable',
  headless: 'new',
  protocolTimeout: 0,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--disable-vulkan-surface'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  await page.goto(new URL(`#rule=${encodeURIComponent(id)}`, server.resolvedUrls.local[0]).href, { waitUntil: 'networkidle0', timeout: 120000 });
  await page.waitForSelector('header h1');
  const ok = await page.evaluate(() => !document.body.innerText.includes('WebGPU'));
  if (!ok) console.log('warning: the page mentions WebGPU (unavailable?)');
  if (cfg.size) await page.evaluate((n) => {
    const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === String(n)) && /size|grid/i.test(s.title + s.closest('label')?.textContent));
    if (!sel) throw new Error('no grid size control found');
    sel.value = String(n);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, cfg.size);
  // parameters, by name: typed into their rows in the panel. A global's row has a 🖌 button; a paintable one's paint
  // value has none, and is spread over the field with Fill all
  const setParams = () => cfg.set ? page.evaluate((set) => {
    const rows = [...document.querySelectorAll('label.row.param')];
    const has = (r, b) => [...r.querySelectorAll('button')].some((x) => x.textContent === b);
    let painted = false;
    for (const [name, v] of Object.entries(set)) {
      const named = rows.filter((r) => r.querySelector('span')?.textContent === name);
      const row = named.find((r) => has(r, '🖌')) ?? named[0];
      if (!row) throw new Error(`no parameter called ${name}`);
      if (!has(row, '🖌')) painted = true;
      const num = row.querySelector('input.num');
      num.value = String(v);
      num.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (painted) [...document.querySelectorAll('button')].find((b) => b.title.startsWith('apply the paint values')).click();
  }, cfg.set) : null;
  // an F/k preset (rules with paintable F and k, like Gray-Scott): set as the background, what the whole unpainted field holds
  const setPreset = () => cfg.preset ? page.evaluate((name) => {
    const all = [...document.querySelectorAll('button')];
    all.find((b) => b.textContent === 'Background' && b.closest('.fk-target')).click();
    const b = all.find((x) => x.textContent === name && x.closest('.presets') && !x.closest('.fk-target'));
    if (!b) throw new Error(`no preset called ${name}`);
    b.click();
  }, cfg.preset) : null;
  await setParams();
  await setPreset();
  // liveSteps: the live loop's steps/frame while the field grows and the colours are rolled (headless, a heavy scene's
  // own, e.g. 333, lost the GPU device); the recording itself keeps the scene's steps per video frame, or steps
  const liveSteps = (n) => n && page.evaluate((n) => { window.rdui.settings.stepsPerFrame = n; window.rdui.sync(); }, n);
  await liveSteps(cfg.liveSteps);
  // record with the Record panel's settings in c; returns the downloaded file's path
  async function recordClip(c, quiet = false) {
    for (const f of fs.readdirSync(dlDir)) fs.rmSync(path.join(dlDir, f));
    const status = await page.evaluate(async (c) => {
      const sec = [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === 'Record');
      if (!sec) throw new Error('no Record section');
      const set = (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
      const byTitle = (t) => sec.querySelector(`input[title^="${t}"]`);
      set(byTitle('length of the video'), c.seconds);
      set(byTitle('video frames per second'), c.fps);
      set(byTitle('sim steps between video frames'), c.steps || '');
      const [scale, quality] = sec.querySelectorAll('select');
      set(scale, c.scale);
      set(quality, { light: 0.1, good: 0.25, high: 0.6 }[c.quality] ?? c.quality);
      const go = [...sec.querySelectorAll('button')].find((b) => b.textContent.includes('Record'));
      go.click();
      const t0 = performance.now();
      for (;;) {
        await new Promise((r) => setTimeout(r, 500));
        const s = [...sec.querySelectorAll('p.hint')].map((p) => p.textContent).find((t) => /^(Saved|Stopped|Couldn't)/.test(t));
        if (s) return s;
        if (performance.now() - t0 > 3600000) return 'timed out';
      }
    }, c);
    if (!quiet) console.log(status);
    // the download lands a moment after the status line
    let file = null;
    for (let i = 0; i < 100 && !file; i++) {
      file = fs.readdirSync(dlDir).find((f) => f.endsWith('.mp4'));
      if (!file) await new Promise((r) => setTimeout(r, 200));
    }
    if (!file) throw new Error('no video was downloaded');
    return path.join(dlDir, file);
  }
  // 🎲 pressed `dice` times: new custom colours, fitted to the field as it is then, so first let the pattern grow
  // (diceWarm seconds, default 6: pressed at the start, they fitted a near-empty field and came out dim), then wait for
  // them to blend in (blend, default 4). The restart below keeps them (the same rule, reloaded)
  if (cfg.dice) {
    await new Promise((r) => setTimeout(r, (cfg.diceWarm ?? 6) * 1000));
    // every reagent coloured (enable all; else only the shown one is, and Gray-Scott's background, all a, stays black),
    // unless channels: 'shown'
    if (cfg.channels !== 'shown') await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Enable All' || b.textContent === 'enable all').click());
    // 🎲 can land dim (it aims each reagent's typical value at 20-45% brightness, so it all depends on the fit): roll, record
    // a 0.3 s probe, measure its mean brightness (0-255), and roll again until it reaches `bright` (default 32), at most
    // `tries` times (default 20; then it keeps the last roll). avoid: mean colours ([r, g, b], 0-255) of earlier takes to
    // stay `apart` from (default 60, as RGB distance), for variants in clearly different colours; the take's own mean
    // colour is printed (colour: [r,g,b]) to pass on
    const brightness = (f) => Number(/YAVG=([\d.]+)/.exec(execFileSync('ffmpeg', ['-v', 'error', '-sseof', '-0.1', '-i', f, '-frames:v', '1', '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], { encoding: 'utf8' }))?.[1] ?? 0);
    // plain blue: the share of the frame in dark, saturated blue (Dan prefers light blue; the custom palette's exponent
    // turns light blues into plain primary blue), rolled again past `blue` (default 0.1)
    const plainBlue = (f) => {
      const px = execFileSync('ffmpeg', ['-v', 'error', '-sseof', '-0.1', '-i', f, '-frames:v', '1', '-vf', 'scale=64:64:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      let n = 0;
      for (let i = 0; i < px.length; i += 3) {
        const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
        if (b > 110 && b > 1.6 * Math.max(r, g, 1) && 0.2126 * r + 0.7152 * g + 0.0722 * b < 75) n++;
      }
      return n / (px.length / 3);
    };
    const meanColour = (f) => [...execFileSync('ffmpeg', ['-v', 'error', '-sseof', '-0.1', '-i', f, '-frames:v', '1', '-vf', 'scale=1:1:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];
    const roll = async () => {
      for (let i = 0; i < cfg.dice; i++) await page.evaluate(() => [...document.querySelectorAll('header button')].find((b) => b.textContent === '🎲').click());
      await new Promise((r) => setTimeout(r, (cfg.blend ?? 4) * 1000));
    };
    let colour = null;
    for (let i = 0; i < (cfg.tries ?? 20); i++) {
      await roll();
      const probe = await recordClip({ ...cfg, seconds: 0.3, scale: 1, quality: 'light' }, true);
      const y = brightness(probe);
      colour = meanColour(probe);
      const near = Math.min(Infinity, ...(cfg.avoid ?? []).map((c) => Math.hypot(c[0] - colour[0], c[1] - colour[1], c[2] - colour[2])));
      const blue = plainBlue(probe);
      console.log(`🎲 ${i + 1}: brightness ${y.toFixed(0)}, plain blue ${(blue * 100).toFixed(0)}%, colour ${colour}${cfg.avoid?.length ? `, ${near.toFixed(0)} from the nearest earlier take` : ''}`);
      if (y >= (cfg.bright ?? 32) && near >= (cfg.apart ?? 60) && blue <= (cfg.blue ?? 0.1)) break;
    }
    console.log(`colour: ${JSON.stringify(colour)}`);
  }
  // a saved look (a take's palette, from its recipe, for a re-roll of the seed only): put back after the field has grown
  // diceWarm seconds (so the rule's own first auto-randomise is over), then blend
  if (cfg.look && !cfg.dice) {
    await new Promise((r) => setTimeout(r, (cfg.diceWarm ?? 6) * 1000));
    await page.evaluate((look) => { Object.assign(window.rdui.settings, structuredClone(look)); window.rdui.sync(); }, cfg.look);
    await new Promise((r) => setTimeout(r, (cfg.blend ?? 4) * 1000));
  }
  // start the rule or scene over (unless restart: false), then record from there
  // (paused first, so the clip starts at the very start: the live loop ran on through the wait below and cut it off; the
  // recorder steps the sim itself)
  const restart = async () => {
    await page.evaluate(() => {
      window.rdui.settings.running = false;
      [...document.querySelectorAll('header button')].find((b) => b.textContent === '⟲').click();
    });
    // (the restart rebuilds the sim: recording straight away caught the old one, destroyed, and gave black frames)
    await new Promise((r) => setTimeout(r, 2000));
    await page.evaluate(() => { window.rdui.settings.running = false; window.rdui.sync(); });
  };
  // (the restart reloads the rule, putting its own parameters and steps/frame back: set them again after each)
  const setUp = async () => {
    await liveSteps(cfg.liveSteps);
    await setParams();
    await setPreset();
  };
  if (cfg.restart !== false) await restart();
  await setUp();
  // a named palette (the palette button opens a grid of tiles: click the named one, the first of that name, then close
  // the grid)
  if (cfg.palette) await page.evaluate((name) => {
    document.querySelector('button.pal-button').click();
    const tile = [...document.querySelectorAll('.pal-tile')].find((t) => t.querySelector('.pal-name')?.textContent === name);
    if (!tile) throw new Error(`no palette called ${name}`);
    tile.click();
    [...document.querySelectorAll('.pal-head button')].find((b) => b.textContent === '✕').click();
  }, cfg.palette);
  // (the live loop runs the warm-up: unpaused for it)
  if (cfg.warm) await page.evaluate(async (n) => {
    window.rdui.settings.running = true;
    const steps = () => Number(document.body.innerText.match(/([\d,]+)\s*steps/)?.[1].replace(/,/g, '') ?? 0);
    const t0 = performance.now();
    while (steps() < n && performance.now() - t0 < 600000) await new Promise((r) => setTimeout(r, 200));
    window.rdui.settings.running = false;
  }, cfg.warm);
  // fit: a pattern that settles early in the clip is recorded again at fewer steps per frame, so its growth fills the clip.
  // A light probe of the whole clip at the sim's own steps (or steps) finds when it settles: the frame-to-frame change
  // (mean abs difference), averaged over each second, stays under `still` (default 0.15) of its busiest second from then
  // on (an absolute level didn't work: a maze drifts on slowly, and the video's own noise is about as big). If that's
  // before 60% of the clip, steps drop so it lands at about 75% (at least 1); printed as `fit: settles at Ts, steps A -> B`
  const ownSteps = cfg.steps;
  if (cfg.fit && cfg.restart !== false && !cfg.warm) {
    const own = cfg.steps || await page.evaluate(() => window.rdui.settings.stepsPerFrame);
    const probe = await recordClip({ ...cfg, steps: own, scale: 1, quality: 'light' }, true);
    const diffs = execFileSync('ffmpeg', ['-v', 'error', '-i', probe, '-vf', 'tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], { encoding: 'utf8' })
      .split('\n').map((l) => /YAVG=([\d.]+)/.exec(l)?.[1]).filter(Boolean).map(Number);
    const secs = [];
    for (let i = 0; i < diffs.length; i += cfg.fps) { const d = diffs.slice(i, i + cfg.fps); secs.push(d.reduce((a, b) => a + b, 0) / d.length); }
    const quiet = (cfg.still ?? 0.15) * Math.max(...secs);
    let last = secs.length - 1;
    while (last >= 0 && secs[last] < quiet) last--;
    const settles = last + 1;
    const steps = settles < 0.6 * cfg.seconds ? Math.max(1, Math.round(own * Math.max(settles, 0.5) / (0.75 * cfg.seconds))) : own;
    console.log(`fit: settles at ${settles.toFixed(1)}s, steps ${own} -> ${steps}`);
    cfg.steps = steps;
    await restart();
    await setUp();
  }
  // erase: soft erase strokes wandering over the field while recording, so a pattern that settles has room to grow again
  // ({} or true for the defaults): one every `every` seconds of video (3), from `from` (3), each `len` seconds long (1.5),
  // `radius` across (0.18 of the field, soft: no hard edge), at `strength` per frame (0.8); each starts 0.3 of the field
  // from the centre, heading through or near it (Dan: paint through the middle)
  // drop: Saturable Schrödinger solitons added on a ring track while recording, moving round it (clockwise) like the ring
  // scenes' own: one every `every` seconds of video (3), from `from` (2), on the ring at (cx, cy) radius r (fractions of
  // the field: 0.5, 0.5, 0.359, the track's centre line), a Gaussian packet of `amp` (2.2) and `sigma` cells (7) at wave
  // number k (0.2), random phase, at a random place on the track (where the field is quiet enough, else skipped)
  await page.evaluate((e, d, fps) => {
    const hooks = [];
    if (e) {
      const { every = 3, from = 3, len = 1.5, radius = 0.18, strength = 0.8 } = e === true ? {} : e;
      let x = 0, y = 0, a = 0;
      hooks.push((i) => {
        const sim = window.rdui.sim, w = sim.width, h = sim.height, t = i / fps - from;
        if (t < 0 || t % every >= len) return;
        // a new stroke: from a random side, aimed through the centre give or take; then on along a gentle curve, across
        // 0.6 of the field
        if (t % every < 1 / fps) {
          const b = Math.random() * 2 * Math.PI;
          x = w / 2 + Math.cos(b) * 0.3 * w; y = h / 2 + Math.sin(b) * 0.3 * h; a = b + Math.PI + (Math.random() - 0.5) * 0.6;
        }
        a += (Math.random() - 0.5) * 0.2;
        const step = 0.6 * w / (len * fps), nx = x + Math.cos(a) * step, ny = y + Math.sin(a) * step;
        sim.brush({ ax: x, ay: y, bx: nx, by: ny, mode: window.rdui.BrushMode.Erase, radius: radius * w, strength, hardness: 0, paint: [] });
        // (wrapped round the edge: carry on from the other side, without a stroke across the field)
        x = (nx + w) % w; y = (ny + h) % h;
      });
    }
    if (d) {
      const { every = 3, from = 2, cx = 0.5, cy = 0.5, r = 0.359, amp = 2.2, sigma = 7, k = 0.2 } = d === true ? {} : d;
      hooks.push(async (i) => {
        const t = i / fps - from;
        if (t < 0 || t % every >= 1 / fps) return;
        const sim = window.rdui.sim, rule = window.rdui.rule, w = sim.width, S4 = sim.layout.S * 4;
        const [p, q, n] = ['p', 'q', 'n'].map((c) => rule.reagents.indexOf(c));
        const th = Math.random() * 2 * Math.PI, phase = Math.random() * 2 * Math.PI;
        const x0 = (cx + r * Math.cos(th)) * w, y0 = (cy + r * Math.sin(th)) * w, kx = -Math.sin(th) * k, ky = Math.cos(th) * k;
        const R = Math.ceil(sigma * 4), side = 2 * R + 1, ox = Math.round(x0) - R, oy = Math.round(y0) - R;
        const { state } = await sim.readRegion(ox, oy, side, side);
        // (not on top of a soliton already there)
        let most = 0;
        for (let c = 0; c < side * side; c++) most = Math.max(most, state[c * S4 + n]);
        if (most > amp * amp * 0.3) return;
        for (let yy = 0; yy < side; yy++) for (let xx = 0; xx < side; xx++) {
          const dx = ox + xx - x0, dy = oy + yy - y0, g = amp * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma)), ph = phase + kx * dx + ky * dy;
          const c = (yy * side + xx) * S4;
          state[c + p] += g * Math.cos(ph); state[c + q] += g * Math.sin(ph);
          if (n >= 0) state[c + n] = state[c + p] ** 2 + state[c + q] ** 2;
        }
        sim.writeRegion(ox, oy, side, side, undefined, state);
      });
    }
    window.rdui.eachFrame = hooks.length ? async (i) => { for (const h of hooks) await h(i); } : null;
  }, cfg.erase ?? false, cfg.drop ?? false, cfg.fps);
  const file = await recordClip(cfg);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.copyFileSync(file, out);
  // the recipe (rule, config and look), beside the clip in .recipes/, for re-rolls (lab/clip-reroll.mjs)
  const look = await page.evaluate(() => {
    const s = window.rdui?.settings;
    return s && { palette: s.palette, custom: s.custom, customContrast: s.customContrast, customSaturation: s.customSaturation, customGamma: s.customGamma, customHeadroom: s.customHeadroom };
  });
  const recipes = path.join(path.dirname(path.resolve(out)), '.recipes');
  fs.mkdirSync(recipes, { recursive: true });
  // (with fit, the steps it started from, so a re-roll fits afresh; fitted: what it chose)
  const { avoid: _, look: __, ...keep } = { ...cfg, ...(cfg.fit && { steps: ownSteps, fitted: cfg.steps }) };
  fs.writeFileSync(path.join(recipes, path.basename(out, '.mp4') + '.json'), JSON.stringify({ id, cfg: keep, look }, null, 1));
  console.log(`${out}: ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
} finally {
  await browser.close();
  await server.close();
  fs.rmSync(dlDir, { recursive: true, force: true });
}
