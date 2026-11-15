/**
 * The explorer: ways through a rule's parameter space, live.
 * - Grid: nine small sims, the centre at the current values and the others with
 *   the unlocked parameters nudged at random (strength = a fraction of each
 *   parameter's range). Tap a tile to make it the centre and nudge again.
 * - Map: one sim where two chosen parameters vary across the field (x rightward,
 *   y upward), seeded everywhere: each spot shows what that pair does, like the
 *   Gray-Scott F/k map. Tap to pick a point.
 * Either can hand its values back to the main sim or save them as a rule.
 */
import { Simulation, type ViewOptions } from './sim';
import { compileRule, initialField, type RuleDef } from './rule';
import { el, button } from './ui';

export interface ExplorerEnv {
  device: GPUDevice;
  format: GPUTextureFormat;
  rule: RuleDef;
  globals: Record<string, number>;
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
  let strength = 0.08;
  let centre: Record<string, number> = { ...env.globals };
  let mode: 'grid' | 'map' = 'grid';

  // --- layout
  const W = window.innerWidth, H = window.innerHeight;
  const area = Math.floor(Math.min(W - 16, H - 150, 900));
  const content = el('div', { class: 'explore-content' });
  const controls = el('div', { class: 'explore-controls' });
  const readout = el('div', { class: 'explore-readout' });
  const tabs = (['grid', 'map'] as const).map((m) => {
    const b = button(m === 'grid' ? 'Grid' : 'Map', () => {
      mode = m;
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
      button('Reseed', () => start(), 'restart from the initial pattern'),
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
  /** Shows `sim` at (x, y, size) in CSS pixels of the screen canvas. */
  function place(sim: Simulation, x: number, y: number, size: number) {
    const px = Math.min(screen.width - Math.round(x * dpr), Math.floor(size * dpr));
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
    tiles = Array.from({ length: 9 }, (_, i) => {
      if (i === 4) return { ...centre };
      const v = { ...centre };
      for (const n of unlocked) {
        const [lo, hi] = range(n);
        v[n] = clamp(n, centre[n] + strength * (hi - lo) * gauss(rnd));
      }
      return v;
    });
    const gap = 6, tileSize = Math.floor((area - 2 * gap) / 3);
    const N = 128;
    const compiled = compileRule(rule);
    const grid = el('div', { class: 'explore-grid' });
    tiles.forEach((vals, i) => {
      const sim = new Simulation(device, format, N, N, compiled);
      sim.setCellScale(env.cell);
      for (const [k, v] of Object.entries(vals)) sim.setGlobal(k, v);
      const f = initialField(rule, N, N, vals, 'zero', env.cell);
      sim.load(f.state, f.params);
      const x = (i % 3) * (tileSize + gap), y = Math.floor(i / 3) * (tileSize + gap);
      place(sim, x, y, tileSize);
      const changed = [...unlocked].map((n) => `${n} ${fmtV(vals[n])}`).join(' · ');
      const tile = el('div', { class: i === 4 ? 'explore-cell centre' : 'explore-cell' }, el('span', {}, changed));
      Object.assign(tile.style, { left: `${x}px`, top: `${y}px`, width: `${tileSize}px`, height: `${tileSize}px` });
      tile.addEventListener('click', () => {
        centre = { ...vals };
        start();
      });
      grid.append(tile);
    });
    content.replaceChildren(el('div', { class: 'explore-box' }, screen, grid));
    readout.textContent = 'Centre: the current values. Tap a variant to make it the centre; Use or Save as rule takes the centre.';
  }
  function gridControls() {
    const chips = el('div', { class: 'explore-chips' }, el('span', { class: 'hint' }, 'vary'));
    for (const p of specs) {
      const b = button(p.name, () => {
        if (unlocked.has(p.name)) unlocked.delete(p.name);
        else unlocked.add(p.name);
        b.classList.toggle('active', unlocked.has(p.name));
      }, 'tap to vary or hold this parameter');
      b.classList.toggle('active', unlocked.has(p.name));
      chips.append(b);
    }
    const s = el('input', { type: 'range', min: '0.01', max: '0.4', step: 'any' });
    s.value = String(strength);
    const out = el('output', {}, `${Math.round(strength * 100)}%`);
    s.addEventListener('input', () => {
      strength = Number(s.value);
      out.textContent = `${Math.round(strength * 100)}%`;
    });
    s.addEventListener('change', () => start());
    controls.replaceChildren(chips, el('label', { class: 'row' }, el('span', {}, 'strength'), s, out));
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
    // seed everywhere with the rule's seed values, so every region gets a chance
    for (let n = 0; n < (N * N) / 700; n++) {
      const cx = rnd() * N, cy = rnd() * N, rad = (3 + rnd() * 5) / env.cell;
      for (let y = Math.floor(cy - rad); y <= cy + rad; y++) for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
        if (x < 1 || y < 1 || x >= N - 1 || y >= N - 1 || (x - cx) ** 2 + (y - cy) ** 2 > rad * rad) continue;
        rule.seed.forEach((v, k) => { if (v !== null) f.state[(y * N + x) * S4 + k] = v + (rnd() - 0.5) * (rule.seedNoise?.[k] ?? 0); });
      }
    }
    sim.load(f.state, f.params);
    place(sim, 0, 0, area);
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
        : `Each spot runs its own ${mx} (x) and ${my} (y). Tap to pick a point; blue ring: current values.`;
    }
    over.addEventListener('pointermove', (e) => drawOver(at(e)));
    over.addEventListener('pointerleave', () => drawOver());
    over.addEventListener('pointerdown', (e) => {
      const [vx, vy] = at(e);
      mapPick = { ...centre, [mx]: vx, [my]: vy };
      drawOver();
    });
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
    sp.addEventListener('change', () => {
      span = Number(sp.value);
      setLimits(mx, null);
      setLimits(my, null);
      start();
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
      return el('label', { class: 'row limits', title: `${n} at the map's ${label === 'x' ? 'left and right' : 'bottom and top'} edges` }, el('span', {}, `${label} ${n}`), a, el('span', { class: 'hint' }, 'to'), b);
    };
    controls.replaceChildren(
      el('div', { class: 'explore-chips' }, el('span', { class: 'hint' }, 'x'), sel(mx, (n) => (mx = n)), el('span', { class: 'hint' }, 'y'), sel(my, (n) => (my = n))),
      el('label', { class: 'row', title: 'how much of each parameter\'s range the map covers, about the current values (resets the limits below)' }, el('span', {}, 'span'), sp, out),
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
    stopSims();
    ctx.unconfigure();
    root.remove();
    window.removeEventListener('keydown', onKey, true);
    env.onClose();
  }
  start();
  if (import.meta.env.DEV) Object.assign(window, { rduiExplorer: { sims: () => sims.map((t) => t.sim) } });
}
