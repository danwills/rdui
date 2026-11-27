/**
 * Live analysis beside the sim (the split view): the field read back a few times a second
 * (its middle 512² at most) and shown as
 * - a phase plot (as Ready has): each dot a cell, at its values of three reagents (a cloud in a cube; drag to turn
 *   it, pinch or the wheel to zoom), or for two the third axis how many cells share the state (log, as a histogram's
 *   height); the same cells each time, gliding from one reading to the next, so the field's states are seen flowing
 *   through the space; each dot coloured as its cell is in the view (brightened where that's dark); tap to step to
 *   the next reagents;
 * - each reagent's histogram, over a range that follows the field (smoothed 1st-99th percentiles);
 * - the shown reagent's mean and spread over time.
 */
import type { Simulation } from './sim';

import type { RGB } from './palettes';

const DOTS = 16000, HBINS = 64, HISTORY = 240, READ_MS = 300;

export interface AnalysisSource {
  sim(): Simulation;
  reagents(): string[];
  /** The reagent the main view shows (the phase plot's first axis to start with). */
  shown(): number;
  /** A cell's colour in the main view from its reagents' values, or null where the plot colours by depth instead. */
  colour?(val: (r: number) => number): RGB | null;
}

export function startAnalysis(canvas: HTMLCanvasElement, src: AnalysisSource) {
  const g = canvas.getContext('2d')!;
  let raf = 0, timer = 0, busy = false, stopped = false;
  let axes: number[] | null = null; // the phase plot's reagents: three (or two, for a two-reagent rule)
  let yaw = 0.7, pitch = 0.45;
  // zoom, and the plot's offset from its box's middle (in CSS pixels)
  let zoom = 1, panX = 0, panY = 0;
  // the dots in groups of one colour (indices into the dots), each group's fill
  let groups: { fill: string; idx: number[] }[] = [];
  // the dots: the same cells each reading (picked once per region size), each at -1..1 on each axis, the last
  // reading (from) and this one (to), eased between over a reading's time
  let cells: Uint32Array | null = null, cellsFor = '';
  let from: Float32Array | null = null, to: Float32Array | null = null, readT = 0;
  // the phase plot's axes span all the dots (rare states are what it's for), smoothed so they don't jump
  let spans: [number, number][] = [];
  let hists: Float32Array[] = [];
  let ranges: [number, number][] = [];
  const history: { mean: number; sd: number }[] = [];
  let names: string[] = [];

  async function sample() {
    if (busy || stopped) return;
    busy = true;
    try {
      const sim = src.sim(), R = src.reagents();
      names = R;
      const w = Math.min(512, sim.width), h = Math.min(512, sim.height);
      const { state } = await sim.readRegion((sim.width - w) >> 1, (sim.height - h) >> 1, w, h);
      if (stopped) return;
      const S4 = sim.layout.S * 4, n = w * h;
      if (!axes || axes.some((r) => r >= R.length)) axes = axesFrom(Math.min(src.shown(), R.length - 1), R.length);
      // ranges: smoothed percentiles from a strided sample
      const stride = Math.max(1, Math.floor(n / 20000));
      const next: [number, number][] = R.map((_, r) => {
        const v: number[] = [];
        for (let i = 0; i < n; i += stride) {
          const x = state[i * S4 + r];
          if (Number.isFinite(x)) v.push(x);
        }
        v.sort((p, q) => p - q);
        let lo = v[Math.floor(v.length * 0.01)] ?? 0, hi = v[Math.floor(v.length * 0.99)] ?? 1;
        if (hi - lo < 1e-6) [lo, hi] = [lo - 0.5, hi + 0.5];
        const pad = (hi - lo) * 0.05;
        return [lo - pad, hi + pad];
      });
      ranges = next.map((nr, r) => (ranges[r] ? [ranges[r][0] * 0.7 + nr[0] * 0.3, ranges[r][1] * 0.7 + nr[1] * 0.3] : nr));
      // 1D histograms
      hists = R.map((_, r) => {
        const [lo, hi] = ranges[r], hs = new Float32Array(HBINS);
        for (let i = 0; i < n; i++) {
          const b = Math.floor(((state[i * S4 + r] - lo) / (hi - lo)) * HBINS);
          if (b >= 0 && b < HBINS) hs[b]++;
        }
        const m = Math.max(...hs) || 1;
        return hs.map((c) => Math.sqrt(c / m));
      });
      // the dots: each picked cell's place on each axis, by the (smoothed) ranges
      if (cellsFor !== `${w}x${h}`) {
        let seed = 12345;
        cells = Uint32Array.from({ length: Math.min(DOTS, n) }, () => ((seed = (seed * 1664525 + 1013904223) >>> 0) % n));
        cellsFor = `${w}x${h}`;
        from = to = null;
      }
      const dots = new Float32Array(cells!.length * 3);
      const span = axes!.map((r): [number, number] => {
        let lo = Infinity, hi = -Infinity;
        for (const c of cells!) { const v = state[c * S4 + r]; if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
        if (!(hi - lo > 1e-9 * Math.max(1, Math.abs(hi)))) [lo, hi] = [lo - 0.5, hi + 0.5];
        const pad = (hi - lo) * 0.04;
        return [lo - pad, hi + pad];
      });
      // (out at once to take in a new extreme, back in gently)
      spans = span.map((sp, k) => (spans[k] ? [Math.min(sp[0], spans[k][0] * 0.8 + sp[0] * 0.2), Math.max(sp[1], spans[k][1] * 0.8 + sp[1] * 0.2)] : sp));
      cells!.forEach((c, i) => axes!.forEach((r, k) => {
        const [lo, hi] = spans[k], v = state[c * S4 + r];
        dots[i * 3 + k] = Number.isFinite(v) ? ((v - lo) / (hi - lo)) * 2 - 1 : NaN;
      }));
      // fewer than three reagents: the next axis is how many dots share each state (log), the rest 0
      if (axes!.length < 3) {
        const B = 32, count = new Float32Array(B * B), k = axes!.length;
        const bin = (i: number) => {
          const x = Math.floor((dots[i * 3] + 1) / 2 * B), y = k > 1 ? Math.floor((dots[i * 3 + 1] + 1) / 2 * B) : 0;
          return x >= 0 && x < B && y >= 0 && y < B ? y * B + x : -1;
        };
        for (let i = 0; i < cells!.length; i++) { const c = bin(i); if (c >= 0) count[c]++; }
        const top = Math.log1p(Math.max(...count)) || 1;
        for (let i = 0; i < cells!.length; i++) {
          const c = bin(i);
          dots[i * 3 + k] = c >= 0 ? (2 * Math.log1p(count[c])) / top - 1 : NaN;
          for (let m = k + 1; m < 3; m++) dots[i * 3 + m] = 0;
        }
      }
      // each dot's colour, as the view shows its cell (brightened so dark ones still show, added up); grouped by colour
      // (quantised), so the plot sets each fill once
      const byFill = new Map<string, number[]>();
      cells!.forEach((c, i) => {
        const v = src.colour?.((r) => state[c * S4 + r]) ?? null;
        let rgb: RGB;
        if (v) {
          const gain = Math.min(5, 1.2 / (Math.max(...v) + 0.2));
          rgb = v.map((x) => Math.min(1, x * gain)) as RGB;
        } else rgb = depthColour(0.15 + 0.85 * (dots[i * 3 + 2] + 1) / 2);
        const fill = `rgba(${rgb.map((x) => Math.round(x * 31) * 8).join(',')},0.4)`;
        let list = byFill.get(fill);
        if (!list) byFill.set(fill, (list = []));
        list.push(i);
      });
      groups = [...byFill].map(([fill, idx]) => ({ fill, idx }));
      from = to && to.length === dots.length ? eased() : dots;
      to = dots;
      readT = performance.now();
      // mean and spread of the shown reagent
      const r0 = Math.min(src.shown(), R.length - 1);
      let sum = 0, sq = 0, cnt = 0;
      for (let i = 0; i < n; i += stride) {
        const x = state[i * S4 + r0];
        if (!Number.isFinite(x)) continue;
        sum += x;
        sq += x * x;
        cnt++;
      }
      const mean = sum / Math.max(1, cnt);
      history.push({ mean, sd: Math.sqrt(Math.max(0, sq / Math.max(1, cnt) - mean * mean)) });
      if (history.length > HISTORY) history.shift();
    } catch {
      // the sim was replaced or the device lost mid-read: the next sample tries again
    } finally {
      busy = false;
    }
  }

  /** Three reagents from `a` on (two if that's all there are). */
  function axesFrom(a: number, count: number) {
    return count >= 3 ? [a, (a + 1) % count, (a + 2) % count] : count === 2 ? [a, 1 - a] : [a];
  }
  /** The dots where they are now: from the last reading towards this one. */
  function eased() {
    if (!from || !to) return to!;
    const u = Math.min(1, (performance.now() - readT) / READ_MS), out = new Float32Array(to.length);
    for (let i = 0; i < to.length; i++) out[i] = from[i] + (to[i] - from[i]) * u;
    return out;
  }

  function depthColour(t: number): RGB {
    // dark blue → cyan → yellow, like the default palette's spirit
    return [Math.min(1, Math.max(0, t * 1.6 - 0.5)), Math.min(1, t * 1.3), Math.min(1, 0.35 + t * 0.9 - Math.max(0, t - 0.7) * 2)];
  }

  function draw() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    if (canvas.width !== Math.floor(W * dpr) || canvas.height !== Math.floor(H * dpr)) {
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0b0c10';
    g.fillRect(0, 0, W, H);
    g.font = '10px ui-monospace, monospace';
    g.textBaseline = 'top';
    if (!to || !axes) {
      g.fillStyle = '#888';
      g.fillText('reading the field…', 8, 8);
      return;
    }
    // layout: the phase plot on the larger side, the strips beside or below it
    const wide = W > H * 1.3;
    const box = wide ? { x: 0, y: 0, w: W * 0.6, h: H } : { x: 0, y: 0, w: W, h: H * 0.62 };
    const strips = wide ? { x: W * 0.6, y: 0, w: W * 0.4, h: H } : { x: 0, y: H * 0.62, w: W, h: H * 0.38 };
    drawPhase(box);
    drawStrips(strips);
  }

  function drawPhase(b: { x: number; y: number; w: number; h: number }) {
    const pts = eased(), A = axes!;
    const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(2));
    // world: each axis -1..1 (a cube, or for two reagents a square seen face on)
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const sc = (Math.min(b.w, b.h - 20) / 3.7) * zoom;
    const ox = b.x + b.w / 2 + panX, oy = b.y + 14 + (b.h - 14) / 2 + panY;
    phaseBox = b;
    g.save();
    g.beginPath();
    g.rect(b.x, b.y, b.w, b.h);
    g.clip();
    const proj = (x: number, y: number, z: number): [number, number] => {
      // turned about the upright (z) axis, then tilted towards the viewer
      const X = x * cy - y * sy, Y = x * sy + y * cy;
      return [ox + X * sc, oy + (Y * sp - z * cp) * sc];
    };
    // the frame: the square, or the cube's edges
    g.strokeStyle = 'rgba(140,160,190,0.35)';
    g.lineWidth = 1;
    g.beginPath();
    const edges: [number[], number[]][] = [];
    for (const u of [-1, 1]) for (const v of [-1, 1]) {
      edges.push([[-1, u, v], [1, u, v]], [[u, -1, v], [u, 1, v]], [[u, v, -1], [u, v, 1]]);
    }
    for (const [p, q] of edges) {
      const a = proj(p[0], p[1], p[2]), c = proj(q[0], q[1], q[2]);
      g.moveTo(a[0], a[1]);
      g.lineTo(c[0], c[1]);
    }
    g.stroke();
    // the dots, added up (where many cells share a state it glows)
    g.globalCompositeOperation = 'lighter';
    const d = Math.max(1.2, Math.min(2.2, sc / 90 / Math.sqrt(zoom)));
    for (const { fill, idx } of groups) {
      g.fillStyle = fill;
      for (const j of idx) {
        const i = j * 3, x = pts[i], y = pts[i + 1], z = pts[i + 2];
        if (!(Math.abs(x) <= 1.05 && Math.abs(y) <= 1.05 && Math.abs(z) <= 1.05)) continue;
        const [px, py] = proj(x, y, z);
        g.fillRect(px - d / 2, py - d / 2, d, d);
      }
    }
    g.globalCompositeOperation = 'source-over';
    // the axes: each reagent's name at its far end, its range from the near corner
    const lab = (p: [number, number], s: string) => {
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.fillText(s, p[0] + 3, p[1] + 2);
    };
    const ends = [[1.12, -1, -1], [-1, 1.12, -1], [-1, -1, 1.12]];
    A.forEach((r, k) => {
      lab(proj(ends[k][0], ends[k][1], ends[k][2]), `${names[r]} ${fmt(spans[k][0])}…${fmt(spans[k][1])}`);
    });
    if (A.length < 3) lab(proj(ends[A.length][0], ends[A.length][1], ends[A.length][2]), 'how many (log)');
    g.restore();
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fillText(`phase plot: ${A.map((r) => names[r]).join(' × ')} (each dot a cell) · drag to turn, pinch or wheel to zoom, tap for the next reagents`, b.x + 6, b.y + 4);
  }

  function drawStrips(b: { x: number; y: number; w: number; h: number }) {
    const R = hists.length, rows = R + 1, gap = 4;
    const rh = (b.h - gap * (rows + 1)) / rows;
    const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(2));
    hists.forEach((hs, r) => {
      const y = b.y + gap + r * (rh + gap), x = b.x + 6, w = b.w - 12;
      g.fillStyle = '#151820';
      g.fillRect(x, y, w, rh);
      g.fillStyle = axes!.includes(r) ? '#66d9ff' : '#7f8aa0';
      const bw = w / HBINS;
      for (let i = 0; i < HBINS; i++) g.fillRect(x + i * bw, y + rh * (1 - hs[i]), Math.max(1, bw - 0.5), rh * hs[i]);
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.fillText(`${names[r]}  ${fmt(ranges[r][0])} … ${fmt(ranges[r][1])}`, x + 3, y + 2);
    });
    // history of the shown reagent: mean (line) and ± spread (band)
    const y = b.y + gap + R * (rh + gap), x = b.x + 6, w = b.w - 12;
    g.fillStyle = '#151820';
    g.fillRect(x, y, w, rh);
    if (history.length > 1) {
      let lo = Infinity, hi = -Infinity;
      for (const s of history) {
        lo = Math.min(lo, s.mean - s.sd);
        hi = Math.max(hi, s.mean + s.sd);
      }
      if (hi - lo < 1e-9) [lo, hi] = [lo - 1, hi + 1];
      const X = (i: number) => x + (i / (HISTORY - 1)) * w, Y = (v: number) => y + rh - ((v - lo) / (hi - lo)) * (rh - 12) - 2;
      g.fillStyle = 'rgba(102,217,255,0.18)';
      g.beginPath();
      history.forEach((s, i) => (i ? g.lineTo(X(i), Y(s.mean + s.sd)) : g.moveTo(X(i), Y(s.mean + s.sd))));
      for (let i = history.length - 1; i >= 0; i--) g.lineTo(X(i), Y(history[i].mean - history[i].sd));
      g.fill();
      g.strokeStyle = '#ffcc66';
      g.beginPath();
      history.forEach((s, i) => (i ? g.lineTo(X(i), Y(s.mean)) : g.moveTo(X(i), Y(s.mean))));
      g.stroke();
      const last = history[history.length - 1];
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.fillText(`${names[Math.min(src.shown(), names.length - 1)]} mean ${fmt(last.mean)} ± ${fmt(last.sd)}`, x + 3, y + 2);
    }
  }

  function frame() {
    draw();
    raf = requestAnimationFrame(frame);
  }

  // one finger (or the mouse) turns the phase plot, two pinch to zoom (and move it); the wheel zooms about the
  // pointer; a tap steps to the next reagents
  let phaseBox = { x: 0, y: 0, w: 0, h: 0 };
  const touches = new Map<number, { x: number; y: number }>();
  let drag: { moved: boolean } | null = null;
  const local = (x: number, y: number) => { const r = canvas.getBoundingClientRect(); return [x - r.left, y - r.top]; };
  /** Zoom by k about the point (x, y) in the canvas, keeping what's under it there. */
  const zoomAt = (x: number, y: number, k: number) => {
    const nz = Math.min(40, Math.max(0.5, zoom * k));
    k = nz / zoom;
    zoom = nz;
    const cx = phaseBox.x + phaseBox.w / 2, cy = phaseBox.y + 14 + (phaseBox.h - 14) / 2;
    panX = x - cx - (x - cx - panX) * k;
    panY = y - cy - (y - cy - panY) * k;
    if (zoom <= 1) panX = panY = 0; // zoomed all the way out: back in the middle, so it can't be lost
  };
  const pair = () => {
    const [a, b] = [...touches.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  const down = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 1) drag = { moved: false };
    else if (drag) drag.moved = true; // a pinch is never a tap
  };
  const move = (e: PointerEvent) => {
    const t = touches.get(e.pointerId);
    if (!t || !drag) return;
    if (touches.size >= 2) {
      const before = pair();
      t.x = e.clientX;
      t.y = e.clientY;
      const after = pair(), [x, y] = local(after.x, after.y);
      if (zoom > 1) {
        panX += after.x - before.x;
        panY += after.y - before.y;
      }
      if (before.d > 1) zoomAt(x, y, after.d / before.d);
      return;
    }
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    yaw += dx * 0.01;
    pitch = Math.min(1.45, Math.max(0.05, pitch + dy * 0.01));
    t.x = e.clientX;
    t.y = e.clientY;
  };
  const up = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    if (touches.size) return;
    if (drag && !drag.moved && e.type === 'pointerup' && axes && names.length > 1) {
      // the next three in turn (or, for two, the other way round)
      axes = axesFrom((axes[0] + 1) % names.length, names.length);
      from = to = null;
      spans = [];
      void sample();
    }
    drag = null;
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    const [x, y] = local(e.clientX, e.clientY);
    zoomAt(x, y, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
  };
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  void sample();
  timer = window.setInterval(() => void sample(), READ_MS);
  raf = requestAnimationFrame(frame);
  return {
    /** The rule changed: start the axes, dots and history again. */
    reset() {
      axes = null;
      from = to = null;
      spans = [];
      ranges = [];
      history.length = 0;
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
    },
  };
}
