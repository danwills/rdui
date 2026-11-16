/**
 * The explorer: ways through a rule's parameter space, live.
 * - Grid: nine small sims, the centre at the current values and the others with
 *   the unlocked parameters nudged at random (strength = a fraction of each
 *   parameter's range, each its own). Tap a tile to make it the centre and nudge again.
 *   "Keep going": the eight outer tiles are fixed directions instead (opposite tiles
 *   opposite; with two parameters, a compass: x the first, y the second), kept from
 *   tap to tap, so tapping the same tile again carries on that way through the space.
 * - Map: one sim where two chosen parameters vary across the field (x rightward,
 *   y upward), seeded everywhere: each spot shows what that pair does, like the
 *   Gray-Scott F/k map. Tap to pick a point.
 * Either can hand its values back to the main sim or save them as a rule.
 */
import { ladder } from './ladder';
import { Simulation, type ViewOptions } from './sim';
import { compileRule, initialField, type RuleDef } from './rule';
import { el, button } from './ui';

export interface ExplorerEnv {
  device: GPUDevice;
  format: GPUTextureFormat;
  rule: RuleDef;
  globals: Record<string, number>;
  /** A piece of the main sim's state (S*4 floats per cell) the explorer's sims can start from. */
  section?: { w: number; h: number; state: Float32Array };
  view(): ViewOptions;
  stepsPerFrame(): number;
  /** Grid spacing (1 / feature size) to run at. */
  cell: number;
  use(values: Record<string, number>): void;
  save(values: Record<string, number>): void;
  onClose(): void;
}

// Params the sim itself reads as globals for its spectral operators: one value per field.
const FIELD_WIDE = ['dx', 'kernel_sigma', 'kernel_b', 'kernel_sigma2', 'lap_size', 'heat_D1', 'heat_D2', 'zoom'];

function gauss(rnd: () => number) {
  return Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
}

const fmtV = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(3));

export function openExplorerPanel(env: ExplorerEnv) {
  const { device, format, rule } = env;
  const specs = rule.params;
  const range = (n: string) => {
    const p = specs.find((q) => q.name === n)!;
    return [Math.min(p.min, env.globals[n]), Math.max(p.max, env.globals[n])] as const;
  };
  const clamp = (n: string, v: number) => {
    const [lo, hi] = range(n);
    return Math.min(hi, Math.max(lo, v));
  };
  const defaults = rule.explore ?? rule.paintable;
  const unlocked = new Set(defaults.length ? defaults : specs.filter((p) => !/^(timestep|clamp)/i.test(p.name)).slice(0, 2).map((p) => p.name));
  // how far each varied parameter is nudged, as a fraction of its range
  const strengths: Record<string, number> = {};
  const strengthOf = (n: string) => strengths[n] ?? 0.08;
  let keepGoing = false;
  let dirs: Record<string, number>[] | null = null; // keep going: each tile's step from the centre
  // restarting the sims on every step of a ladder drag would stall it: wait for a pause
  let restartTimer = 0;
  const restartSoon = () => {
    clearTimeout(restartTimer);
    restartTimer = window.setTimeout(() => start(), 250);
  };
  let centre: Record<string, number> = { ...env.globals };
  // the mode it was last in (this browser)
  const MODE_KEY = 'rdui.exploreMode';
  let mode: 'grid' | 'map' = 'grid';
  try { if (localStorage.getItem(MODE_KEY) === 'map') mode = 'map'; } catch { /* no storage */ }
  // a colour per parameter: chips, strength rows, trajectories and the tiles' dots
  const PARAM_COLOURS = ['#ff9f43', '#4fc3ff', '#9be15d', '#ff6bcb', '#ffe066', '#a78bfa', '#5eead4', '#f87171', '#c4b5fd', '#fdba74'];
  const colourOf = (n: string) => PARAM_COLOURS[Math.max(0, specs.findIndex((p) => p.name === n)) % PARAM_COLOURS.length];
  // the centres visited (grid taps), for each strength row's trajectory
  let history: Record<string, number>[] = [{ ...env.globals }];
  let fromSim = !!env.section;
  /** Fills an N×N state with the main sim's piece (its middle, or repeated if it's smaller); false if there's none. */
  function fromSection(state: Float32Array, N: number, S4: number) {
    const sec = env.section;
    if (!fromSim || !sec) return false;
    const ox = Math.max(0, (sec.w - N) >> 1), oy = Math.max(0, (sec.h - N) >> 1);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const j = (((y + oy) % sec.h) * sec.w + ((x + ox) % sec.w)) * S4;
      state.set(sec.state.subarray(j, j + S4), (y * N + x) * S4);
    }
    return true;
  }

  // --- layout
  const W = window.innerWidth, H = window.innerHeight;
  const area = Math.floor(Math.min(W - 16, H - 150, 900));
  const content = el('div', { class: 'explore-content' });
  const controls = el('div', { class: 'explore-controls' });
  const readout = el('div', { class: 'explore-readout' });
  function startFrom() {
    const label = () => (fromSim ? 'From: this sim' : 'From: fresh');
    const b = button(label(), () => {
      fromSim = !fromSim;
      b.textContent = label();
      start();
    }, 'start the sims from a piece of the main sim (its middle), or from the rule\'s own pattern');
    return b;
  }
  const tabs = (['grid', 'map'] as const).map((m) => {
    const b = button(m === 'grid' ? 'Grid' : 'Map', () => {
      mode = m;
      try { localStorage.setItem(MODE_KEY, m); } catch { /* no storage */ }
      tabs.forEach((t, i) => t.classList.toggle('active', ['grid', 'map'][i] === mode));
      start();
    }, m === 'grid' ? 'nine variants around the current values' : 'two parameters across the field');
    b.classList.toggle('active', m === mode);
    return b;
  });
  const root = el('div', { class: 'explore' },
    el('div', { class: 'explore-bar' }, ...tabs,
      button('Use', () => { env.use(picked()); close(); }, 'run the main sim with these values'),
      button('Save as rule…', () => {
        const v = picked();
        close();
        env.save(v);
      }, 'keep these values as a new rule under My rules'),
      ...(env.section ? [startFrom()] : []),
      button('Reseed', () => start(), 'start the sims again'),
      button('✕', () => close(), 'close · Esc')),
    controls, content, readout);
  document.body.append(root);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    e.stopPropagation();
  };
  window.addEventListener('keydown', onKey, true);

  // --- sims and the frame loop. One WebGPU canvas for everything (several
  // contexts are heavy on phones): each sim renders into its own texture,
  // copied into the canvas at its tile's place.
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const screen = el('canvas', { class: 'explore-screen' });
  screen.width = screen.height = Math.floor(area * dpr);
  screen.style.width = screen.style.height = `${area}px`;
  const ctx = screen.getContext('webgpu')!;
  ctx.configure({ device, format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST });
  let sims: { sim: Simulation; tex: GPUTexture; x: number; y: number }[] = [];
  let raf = 0;
  function stopSims() {
    cancelAnimationFrame(raf);
    for (const t of sims) {
      t.sim.destroy();
      t.tex.destroy();
    }
    sims = [];
  }
  /** The screen canvas's size in CSS pixels (the grid: a square; the map: the map and its preview). */
  function sizeScreen(w: number, h: number) {
    screen.width = Math.floor(w * dpr);
    screen.height = Math.floor(h * dpr);
    screen.style.width = `${w}px`;
    screen.style.height = `${h}px`;
  }
  /** Shows `sim` at (x, y, size) in CSS pixels of the screen canvas. */
  function place(sim: Simulation, x: number, y: number, size: number) {
    const px = Math.min(screen.width - Math.round(x * dpr), screen.height - Math.round(y * dpr), Math.floor(size * dpr));
    const tex = device.createTexture({ size: [px, px], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    sims.push({ sim, tex, x: Math.round(x * dpr), y: Math.round(y * dpr) });
  }
  function loop() {
    const enc = device.createCommandEncoder();
    const target = ctx.getCurrentTexture();
    for (const t of sims) {
      t.sim.step(enc, env.stepsPerFrame());
      t.sim.render(enc, t.tex.createView(), t.tex.width, t.tex.height, env.view());
      enc.copyTextureToTexture({ texture: t.tex }, { texture: target, origin: [t.x, t.y] }, [t.tex.width, t.tex.height]);
    }
    device.queue.submit([enc.finish()]);
    raf = requestAnimationFrame(loop);
  }

  // --- grid
  let tiles: Record<string, number>[] = [];
  let mapPick: Record<string, number> | null = null;
  const picked = () => (mode === 'map' && mapPick ? mapPick : centre);
  function startGrid() {
    const rnd = Math.random;
    const step = (n: string) => { const [lo, hi] = range(n); return strengthOf(n) * (hi - lo); };
    if (keepGoing) {
      if (!dirs) {
        const vary = [...unlocked];
        dirs = Array.from({ length: 9 }, () => ({} as Record<string, number>));
        if (vary.length === 2) {
          // a compass: left/right the first parameter, down/up the second
          dirs.forEach((d, i) => {
            d[vary[0]] = ((i % 3) - 1) * step(vary[0]);
            d[vary[1]] = (1 - Math.floor(i / 3)) * step(vary[1]);
          });
        } else {
          for (let i = 0; i < 4; i++) for (const n of vary) {
            dirs[i][n] = step(n) * gauss(rnd);
            dirs[8 - i][n] = -dirs[i][n];
          }
        }
      }
      tiles = dirs.map((d) => {
        const v = { ...centre };
        for (const [n, dv] of Object.entries(d)) v[n] = clamp(n, centre[n] + dv);
        return v;
      });
    } else {
      tiles = Array.from({ length: 9 }, (_, i) => {
        if (i === 4) return { ...centre };
        const v = { ...centre };
        for (const n of unlocked) v[n] = clamp(n, centre[n] + step(n) * gauss(rnd));
        return v;
      });
    }
    sizeScreen(area, area);
    const gap = 6, tileSize = Math.floor((area - 2 * gap) / 3);
    const N = 128;
    const compiled = compileRule(rule);
    const grid = el('div', { class: 'explore-grid' });
    tiles.forEach((vals, i) => {
      const sim = new Simulation(device, format, N, N, compiled);
      sim.setCellScale(env.cell);
      for (const [k, v] of Object.entries(vals)) sim.setGlobal(k, v);
      const f = initialField(rule, N, N, vals, 'zero', env.cell);
      fromSection(f.state, N, compiled.layout.S * 4);
      sim.load(f.state, f.params);
      const x = (i % 3) * (tileSize + gap), y = Math.floor(i / 3) * (tileSize + gap);
      place(sim, x, y, tileSize);
      const changed = [...unlocked].map((n) => `${n} ${fmtV(vals[n])}`).join(' · ');
      // where tapping this tile moves each parameter: a dot in its colour, sized by the step
      // (in strengths), filled for up and hollow for down
      const dots = el('div', { class: 'explore-dots' });
      if (i !== 4) for (const n of unlocked) {
        const [lo, hi] = range(n), d = (vals[n] - centre[n]) / Math.max(1e-12, strengthOf(n) * (hi - lo));
        const r = 3 + Math.min(7, 3.5 * Math.abs(d));
        const c = colourOf(n);
        const dot = el('span', { title: `${n} ${d >= 0 ? '+' : ''}${fmtV(vals[n] - centre[n])}` });
        Object.assign(dot.style, { width: `${2 * r}px`, height: `${2 * r}px`, background: d > 0 ? c : 'transparent', border: `2px solid ${c}`, opacity: Math.abs(d) < 0.05 ? '0.35' : '1' });
        dots.append(dot);
      }
      const tile = el('div', { class: i === 4 ? 'explore-cell centre' : 'explore-cell' }, dots, el('span', {}, changed));
      Object.assign(tile.style, { left: `${x}px`, top: `${y}px`, width: `${tileSize}px`, height: `${tileSize}px` });
      tile.addEventListener('click', () => {
        centre = { ...vals };
        if (i !== 4) history = [...history, { ...vals }].slice(-24);
        start();
      });
      grid.append(tile);
    });
    content.replaceChildren(el('div', { class: 'explore-box' }, screen, grid));
    readout.textContent = keepGoing
      ? 'Keep going: each tile is a direction (opposite tiles opposite). Tap one to move that way; tap it again to carry on. Use or Save as rule takes the centre.'
      : 'Centre: the current values. Tap a variant to make it the centre; Use or Save as rule takes the centre.';
  }
  function gridControls() {
    const chips = el('div', { class: 'explore-chips' }, el('span', { class: 'hint' }, 'vary'));
    for (const p of specs) {
      const b = button(p.name, () => {
        if (unlocked.has(p.name)) unlocked.delete(p.name);
        else unlocked.add(p.name);
        dirs = null;
        start(); // (rebuilds these controls too: a strength row per varied parameter)
      }, 'tap to vary or hold this parameter');
      b.classList.toggle('active', unlocked.has(p.name));
      if (unlocked.has(p.name)) Object.assign(b.style, { borderColor: colourOf(p.name), color: colourOf(p.name) });
      chips.append(b);
    }
    // a strength per varied parameter (with the value ladder: middle button or long-press)
    const MIN = 0.001, MAX = 1;
    const strengthRow = (n: string) => {
      const s = el('input', { type: 'range', min: '0.01', max: '0.4', step: 'any' });
      const out = el('output');
      const show = () => {
        s.value = String(strengthOf(n));
        out.textContent = `${+(strengthOf(n) * 100).toPrecision(3)}%`;
      };
      const set = (v: number) => {
        strengths[n] = Math.min(MAX, Math.max(MIN, v));
        dirs = null;
        show();
      };
      s.addEventListener('input', () => set(Number(s.value)));
      s.addEventListener('change', () => start());
      show();
      // the trajectory: this parameter over the last centres visited (scaled to their spread)
      const spark = el('canvas', { class: 'explore-spark', title: `${n} over the last ${history.length} centres` });
      const SW = 72, SH = 18, dpr2 = Math.min(2, window.devicePixelRatio || 1);
      spark.width = SW * dpr2;
      spark.height = SH * dpr2;
      const g = spark.getContext('2d')!;
      g.scale(dpr2, dpr2);
      const vs = history.map((h) => h[n] ?? centre[n]);
      let lo = Math.min(...vs), hi = Math.max(...vs);
      if (hi - lo < 1e-12) { lo -= 1; hi += 1; }
      const px = (k: number) => (vs.length < 2 ? SW - 4 : 3 + (k / (vs.length - 1)) * (SW - 7)), py = (v: number) => SH - 3 - ((v - lo) / (hi - lo)) * (SH - 6);
      g.strokeStyle = colourOf(n);
      g.globalAlpha = 0.8;
      g.lineWidth = 1.5;
      g.beginPath();
      vs.forEach((v, k) => (k ? g.lineTo(px(k), py(v)) : g.moveTo(px(k), py(v))));
      g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = colourOf(n);
      g.beginPath();
      g.arc(px(vs.length - 1), py(vs[vs.length - 1]), 2.5, 0, Math.PI * 2);
      g.fill();
      const name = el('span', {}, n);
      name.style.color = colourOf(n);
      const row = el('label', { class: 'row strength', title: `how far ${n} is nudged, as a fraction of its range` }, name, s, out, spark);
      ladder(row, { get: () => strengthOf(n), set: (v) => { set(v); restartSoon(); }, range: [0, 1], clamp: [MIN, MAX] });
      return row;
    };
    const go = el('input', { type: 'checkbox' });
    go.checked = keepGoing;
    go.addEventListener('change', () => {
      keepGoing = go.checked;
      dirs = null;
      start();
    });
    controls.replaceChildren(chips,
      el('label', { class: 'check', title: 'tiles become fixed directions, kept from tap to tap: tap one to move that way, again to carry on' }, go, 'keep going'),
      el('div', { class: 'hint' }, 'strength'),
      ...[...unlocked].map(strengthRow));
  }

  // --- map
  const fieldWide = rule.laplacian?.startsWith('spectral') ? FIELD_WIDE : ['dx'];
  const mappable = specs.map((p) => p.name).filter((n) => !fieldWide.includes(n));
  const firstTwo = [...unlocked].filter((n) => mappable.includes(n));
  let mx = firstTwo[0] ?? mappable[0], my = firstTwo[1] ?? mappable.find((n) => n !== mx) ?? mx;
  let span = 1;
  function window_(n: string): [number, number] {
    const [lo, hi] = range(n), w = ((hi - lo) * span) / 2;
    const c = Math.min(hi - w, Math.max(lo + w, centre[n]));
    return [c - w, c + w];
  }
  // limits typed in for an axis win over the span's window; kept per rule and parameter in this browser
  const limitKey = (n: string) => `rdui.mapLimits.${rule.name}.${n}`;
  const limits = (n: string): [number, number] => {
    try {
      const v = JSON.parse(localStorage.getItem(limitKey(n)) ?? 'null');
      if (Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) && v[0] !== v[1]) return [v[0], v[1]];
    } catch { /* no storage */ }
    return window_(n);
  };
  const setLimits = (n: string, v: [number, number] | null) => {
    try {
      if (v) localStorage.setItem(limitKey(n), JSON.stringify(v));
      else localStorage.removeItem(limitKey(n));
    } catch { /* no storage */ }
  };
  function startMap() {
    // the map and, beside it (below on a portrait screen), a preview running the picked point
    // everywhere, so dragging the point shows its effect at once
    const GAP = 8, wide = W > H;
    const m = Math.floor(wide ? Math.min(H - 150, (W - 16 - GAP) / 2, 700) : Math.min(W - 16, 700));
    const pv = wide ? m : Math.floor(Math.min(m, Math.max(160, H - 150 - m - GAP)));
    sizeScreen(wide ? m + GAP + pv : m, wide ? m : m + GAP + pv);
    const area = m; // (the map's size, below)
    const N = 256;
    const paintable = [...new Set([mx, my, ...rule.paintable])].slice(0, 7);
    const r: RuleDef = { ...rule, paintable };
    const compiled = compileRule(r);
    const sim = new Simulation(device, format, N, N, compiled);
    sim.setCellScale(env.cell);
    for (const [k, v] of Object.entries(centre)) sim.setGlobal(k, v);
    const f = initialField(r, N, N, centre, 'zero', env.cell);
    const S4 = compiled.layout.S * 4, P4 = compiled.layout.P * 4, names = compiled.layout.paramNames;
    const ix = names.indexOf(mx), iy = names.indexOf(my), [x0, x1] = limits(mx), [y0, y1] = limits(my);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      f.params[i * P4 + ix] = x0 + ((x + 0.5) / N) * (x1 - x0);
      f.params[i * P4 + iy] = y1 - ((y + 0.5) / N) * (y1 - y0);
      if (x === 0 || y === 0 || x === N - 1 || y === N - 1) f.params[i * P4] = 1; // walls: opposite edges don't mix (stencil rules)
    }
    // start from the main sim's piece, or seed everywhere with the rule's seed values, so every region gets a chance
    if (!fromSection(f.state, N, S4)) for (let n = 0; n < (N * N) / 700; n++) {
      const cx = rnd() * N, cy = rnd() * N, rad = (3 + rnd() * 5) / env.cell;
      for (let y = Math.floor(cy - rad); y <= cy + rad; y++) for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
        if (x < 1 || y < 1 || x >= N - 1 || y >= N - 1 || (x - cx) ** 2 + (y - cy) ** 2 > rad * rad) continue;
        rule.seed.forEach((v, k) => { if (v !== null) f.state[(y * N + x) * S4 + k] = v + (rnd() - 0.5) * (rule.seedNoise?.[k] ?? 0); });
      }
    }
    sim.load(f.state, f.params);
    place(sim, 0, 0, area);

    // the preview: the rule with the two axes as plain globals, so dragging sets them live
    const PN = 160;
    const pr: RuleDef = { ...rule, paintable: rule.paintable.filter((n) => n !== mx && n !== my) };
    const pc = compileRule(pr);
    const preview = new Simulation(device, format, PN, PN, pc);
    preview.setCellScale(env.cell);
    const pvals = mapPick ?? centre;
    for (const [k, v] of Object.entries(pvals)) preview.setGlobal(k, v);
    const pf = initialField(pr, PN, PN, pvals, 'zero', env.cell);
    fromSection(pf.state, PN, pc.layout.S * 4);
    preview.load(pf.state, pf.params);
    place(preview, wide ? area + GAP : 0, wide ? 0 : area + GAP, pv);
    const setPick = (vx: number, vy: number) => {
      mapPick = { ...centre, [mx]: vx, [my]: vy };
      preview.setGlobal(mx, vx);
      preview.setGlobal(my, vy);
    };

    // axes, readout and the picked point on a 2D layer
    const over = el('canvas', { class: 'explore-over' });
    over.width = over.height = Math.floor(area * dpr);
    over.style.width = over.style.height = `${area}px`;
    const o = over.getContext('2d')!;
    const at = (e: PointerEvent): [number, number] => {
      const b = over.getBoundingClientRect();
      const fx = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), fy = Math.min(1, Math.max(0, (e.clientY - b.top) / b.height));
      return [x0 + fx * (x1 - x0), y1 - fy * (y1 - y0)];
    };
    function drawOver(hover?: [number, number]) {
      o.setTransform(dpr, 0, 0, dpr, 0, 0);
      o.clearRect(0, 0, area, area);
      o.font = '11px ui-monospace, monospace';
      o.lineWidth = 3;
      const t = (s: string, x: number, y: number) => {
        o.strokeStyle = 'rgba(0,0,0,0.7)';
        o.strokeText(s, x, y);
        o.fillStyle = 'rgba(255,255,255,0.85)';
        o.fillText(s, x, y);
      };
      for (let i = 1; i < 5; i++) {
        t(fmtV(x0 + (i / 5) * (x1 - x0)), (i / 5) * area - 14, area - 6);
        t(fmtV(y1 - (i / 5) * (y1 - y0)), 4, (i / 5) * area + 4);
      }
      t(`${mx} →`, area - 60, area - 20);
      t(`${my} ↑`, 4, 14);
      const mark = (vx: number, vy: number, col: string) => {
        o.strokeStyle = col;
        o.lineWidth = 2;
        o.beginPath();
        o.arc(((vx - x0) / (x1 - x0)) * area, ((y1 - vy) / (y1 - y0)) * area, 7, 0, Math.PI * 2);
        o.stroke();
      };
      mark(centre[mx], centre[my], '#66d9ff');
      if (mapPick) mark(mapPick[mx], mapPick[my], '#ffcc66');
      const cur = hover ?? (mapPick ? [mapPick[mx], mapPick[my]] : null);
      readout.textContent = cur
        ? `${hover ? 'pointer' : 'picked'} ${mx} ${fmtV(cur[0])} · ${my} ${fmtV(cur[1])}${hover ? '' : ' (Use or Save as rule takes it)'}`
        : `Each spot runs its own ${mx} (x) and ${my} (y). Tap or drag to pick a point (the preview runs it); blue ring: current values.`;
    }
    let dragging = false;
    over.addEventListener('pointermove', (e) => {
      if (dragging) {
        setPick(...at(e));
        drawOver();
      } else drawOver(at(e));
    });
    over.addEventListener('pointerleave', () => { if (!dragging) drawOver(); });
    over.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      over.setPointerCapture(e.pointerId);
      setPick(...at(e));
      drawOver();
    });
    for (const t of ['pointerup', 'pointercancel']) over.addEventListener(t, () => (dragging = false));
    content.replaceChildren(el('div', { class: 'explore-box' }, screen, over));
    drawOver();
  }
  function mapControls() {
    const sel = (cur: string, set: (n: string) => void) => {
      const s = el('select', {}, ...mappable.map((n) => el('option', { value: n }, n)));
      s.value = cur;
      s.addEventListener('change', () => {
        set(s.value);
        mapPick = null;
        start();
      });
      return s;
    };
    const sp = el('input', { type: 'range', min: '0.02', max: '1', step: 'any' });
    sp.value = String(span);
    const out = el('output', {}, `${Math.round(span * 100)}%`);
    sp.addEventListener('input', () => (out.textContent = `${Math.round(Number(sp.value) * 100)}%`));
    const setSpan = (v: number) => {
      span = v;
      setLimits(mx, null);
      setLimits(my, null);
    };
    sp.addEventListener('change', () => {
      setSpan(Number(sp.value));
      start();
    });
    const spanRow = el('label', { class: 'row', title: 'how much of each parameter\'s range the map covers, about the current values (resets the limits below)' }, el('span', {}, 'span'), sp, out);
    ladder(spanRow, {
      get: () => span,
      set: (v) => { setSpan(v); sp.value = String(v); out.textContent = `${+(v * 100).toPrecision(3)}%`; restartSoon(); },
      range: [0, 1], clamp: [0.001, 1],
    });
    // each axis's ends, typed in: any values (beyond the slider ranges too); low > high flips the axis
    const limitRow = (n: string, label: string) => {
      const [lo, hi] = limits(n);
      const box = (v: number) => el('input', { type: 'number', step: 'any', value: String(+v.toPrecision(6)), class: 'limit' });
      const a = box(lo), b = box(hi);
      const apply = () => {
        const v: [number, number] = [Number(a.value), Number(b.value)];
        if (!v.every(Number.isFinite) || v[0] === v[1]) return;
        setLimits(n, v);
        mapPick = null;
        start();
      };
      a.addEventListener('change', apply);
      b.addEventListener('change', apply);
      // the value ladder on each end (middle button or long-press), stepping in this axis's units
      for (const box of [a, b]) ladder(box, {
        get: () => Number(box.value),
        set: (v) => { box.value = String(+v.toPrecision(8)); clearTimeout(restartTimer); restartTimer = window.setTimeout(apply, 250); },
        range: range(n) as [number, number],
      });
      return el('label', { class: 'row limits', title: `${n} at the map's ${label === 'x' ? 'left and right' : 'bottom and top'} edges` }, el('span', {}, `${label} ${n}`), a, el('span', { class: 'hint' }, 'to'), b);
    };
    controls.replaceChildren(
      el('div', { class: 'explore-chips' }, el('span', { class: 'hint' }, 'x'), sel(mx, (n) => (mx = n)), el('span', { class: 'hint' }, 'y'), sel(my, (n) => (my = n))),
      spanRow,
      limitRow(mx, 'x'),
      limitRow(my, 'y'),
      ...(fieldWide.length > 1 ? [el('p', { class: 'hint' }, `FFT rule: ${fieldWide.filter((n) => specs.some((p) => p.name === n)).join(', ')} can't vary across the field, so they aren't offered.`)] : []),
    );
  }

  function start() {
    stopSims();
    if (mode === 'grid') {
      gridControls();
      startGrid();
    } else {
      mapControls();
      startMap();
    }
    raf = requestAnimationFrame(loop);
  }
  function close() {
    clearTimeout(restartTimer);
    stopSims();
    ctx.unconfigure();
    root.remove();
    window.removeEventListener('keydown', onKey, true);
    env.onClose();
  }
  start();
  if (import.meta.env.DEV) Object.assign(window, { rduiExplorer: { sims: () => sims.map((t) => t.sim) } });
}
