/**
 * Live analysis beside the sim (the split view): the field read back a few times a second
 * (its middle 512² at most) and shown as
 * - a 3D histogram: the joint histogram of two reagents as a height field (log counts),
 *   slowly turning; drag to turn it, tap to step to the next pair of reagents;
 * - each reagent's histogram, over a range that follows the field (smoothed 1st-99th percentiles);
 * - the shown reagent's mean and spread over time.
 */
import type { Simulation } from './sim';

const BINS = 40, HBINS = 64, HISTORY = 240, READ_MS = 300;

export interface AnalysisSource {
  sim(): Simulation;
  reagents(): string[];
  /** The reagent the main view shows (the 3D histogram's first axis to start with). */
  shown(): number;
}

export function startAnalysis(canvas: HTMLCanvasElement, src: AnalysisSource) {
  const g = canvas.getContext('2d')!;
  let raf = 0, timer = 0, busy = false, stopped = false;
  let pair: [number, number] | null = null;
  let yaw = 0.7, pitch = 0.55, spinning = true;
  let joint: Float32Array | null = null; // BINS², log counts normalised to 0..1
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
      if (!pair || pair[0] >= R.length || pair[1] >= R.length) {
        const a = Math.min(src.shown(), R.length - 1);
        pair = [a, R.length > 1 ? (a + 1) % R.length : a];
      }
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
      // joint histogram of the pair
      const [ra, rb] = pair, [alo, ahi] = ranges[ra], [blo, bhi] = ranges[rb];
      const j = new Float32Array(BINS * BINS);
      for (let i = 0; i < n; i++) {
        const x = Math.floor(((state[i * S4 + ra] - alo) / (ahi - alo)) * BINS);
        const y = Math.floor(((state[i * S4 + rb] - blo) / (bhi - blo)) * BINS);
        if (x >= 0 && x < BINS && y >= 0 && y < BINS) j[y * BINS + x]++;
      }
      const top = Math.log1p(Math.max(...j)) || 1;
      joint = j.map((c) => Math.log1p(c) / top);
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

  function colour(t: number) {
    // dark blue → cyan → yellow, like the default palette's spirit
    const r = Math.round(255 * Math.min(1, Math.max(0, t * 1.6 - 0.5)));
    const gg = Math.round(255 * Math.min(1, t * 1.3));
    const b = Math.round(255 * Math.min(1, 0.35 + t * 0.9 - Math.max(0, t - 0.7) * 2));
    return `rgb(${r},${gg},${b})`;
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
    if (!joint || !pair) {
      g.fillStyle = '#888';
      g.fillText('reading the field…', 8, 8);
      return;
    }
    // layout: the 3D histogram on the larger side, the strips beside or below it
    const wide = W > H * 1.3;
    const box = wide ? { x: 0, y: 0, w: W * 0.6, h: H } : { x: 0, y: 0, w: W, h: H * 0.62 };
    const strips = wide ? { x: W * 0.6, y: 0, w: W * 0.4, h: H } : { x: 0, y: H * 0.62, w: W, h: H * 0.38 };
    draw3d(box);
    drawStrips(strips);
  }

  function draw3d(b: { x: number; y: number; w: number; h: number }) {
    const j = joint!, [ra, rb] = pair!;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // the floor's diagonal (2√2) plus the height must fit the box whichever way it's turned
    const sc = Math.min(b.w / 3.1, b.h / (2.9 * Math.sin(pitch) + 1.2 * Math.cos(pitch) + 0.3));
    const ox = b.x + b.w / 2, oy = b.y + b.h * 0.5 + sc * (1.1 * Math.cos(pitch) - 0.05) / 2;
    // world: x, y in [-1, 1] (the two reagents), z = height in [0, 1.1]
    const proj = (x: number, y: number, z: number): [number, number, number] => {
      const X = x * cy - y * sy, Y = x * sy + y * cy;
      return [ox + X * sc, oy + (Y * sp - z * cp) * sc, Y * cp + z * sp];
    };
    const at = (i: number, k: number) => j[k * BINS + i] * 1.1;
    const P = (i: number, k: number) => proj((i / (BINS - 1)) * 2 - 1, (k / (BINS - 1)) * 2 - 1, at(i, k));
    // floor frame
    g.strokeStyle = 'rgba(140,160,190,0.35)';
    g.lineWidth = 1;
    g.beginPath();
    for (const [x0, y0, x1, y1] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
      const a = proj(x0, y0, 0), c = proj(x1, y1, 0);
      g.moveTo(a[0], a[1]);
      g.lineTo(c[0], c[1]);
    }
    g.stroke();
    // the surface as quads, painted back to front
    const quads: { d: number; pts: [number, number][]; v: number }[] = [];
    for (let k = 0; k < BINS - 1; k++) for (let i = 0; i < BINS - 1; i++) {
      const v = (j[k * BINS + i] + j[k * BINS + i + 1] + j[(k + 1) * BINS + i] + j[(k + 1) * BINS + i + 1]) / 4;
      if (v <= 0.001) continue;
      const a = P(i, k), c = P(i + 1, k), d = P(i + 1, k + 1), e = P(i, k + 1);
      quads.push({ d: a[2] + c[2] + d[2] + e[2], pts: [[a[0], a[1]], [c[0], c[1]], [d[0], d[1]], [e[0], e[1]]], v });
    }
    quads.sort((p, q) => q.d - p.d);
    for (const q of quads) {
      g.fillStyle = colour(q.v);
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.moveTo(q.pts[0][0], q.pts[0][1]);
      for (let m = 1; m < 4; m++) g.lineTo(q.pts[m][0], q.pts[m][1]);
      g.closePath();
      g.fill();
      g.stroke();
    }
    // axis labels at the floor's edges
    const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(2));
    const lab = (x: number, y: number, s: string) => {
      const p = proj(x, y, 0);
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.fillText(s, p[0] + 3, p[1] + 2);
    };
    lab(1.1, -1, `${names[ra]} →`);
    lab(-1, 1.1, `${names[rb]} →`);
    lab(-1, -1, `${fmt(ranges[ra][0])},${fmt(ranges[rb][0])}`);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fillText(`3D histogram: ${names[ra]} × ${names[rb]} (log counts) · drag to turn, tap for the next pair`, b.x + 6, b.y + 4);
  }

  function drawStrips(b: { x: number; y: number; w: number; h: number }) {
    const R = hists.length, rows = R + 1, gap = 4;
    const rh = (b.h - gap * (rows + 1)) / rows;
    const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(2));
    hists.forEach((hs, r) => {
      const y = b.y + gap + r * (rh + gap), x = b.x + 6, w = b.w - 12;
      g.fillStyle = '#151820';
      g.fillRect(x, y, w, rh);
      g.fillStyle = r === pair![0] || r === pair![1] ? '#66d9ff' : '#7f8aa0';
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
    if (spinning) yaw += 0.004;
    draw();
    raf = requestAnimationFrame(frame);
  }

  // drag turns the 3D histogram; a tap steps to the next pair of reagents
  let drag: { x: number; y: number; moved: boolean } | null = null;
  const down = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, moved: false };
  };
  const move = (e: PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    spinning = false;
    yaw += dx * 0.01;
    pitch = Math.min(1.45, Math.max(0.05, pitch + dy * 0.01));
    drag.x = e.clientX;
    drag.y = e.clientY;
  };
  const up = () => {
    if (drag && !drag.moved && pair && names.length > 1) {
      // all ordered pairs of different reagents in turn
      let [a, b] = pair;
      b = (b + 1) % names.length;
      if (b === a) {
        a = (a + 1) % names.length;
        b = (a + 1) % names.length;
      }
      pair = [a, b];
      void sample();
    }
    drag = null;
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  void sample();
  timer = window.setInterval(() => void sample(), READ_MS);
  raf = requestAnimationFrame(frame);
  return {
    /** The rule changed: start the pair and history again. */
    reset() {
      pair = null;
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
    },
  };
}
