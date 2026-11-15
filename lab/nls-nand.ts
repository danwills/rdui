// A wall-free NAND from Schrödinger soliton collisions, run for all four inputs.
//   AND: A (heading +h) and B (heading −h), in phase, meet at P1 and merge into one heavy soliton
//        heading east; either alone carries on at ±h.
//   NOT: a clock soliton C (always sent) crosses the merged soliton's path at P2, timed to meet it
//        there: hit, it's knocked off course; alone, it reaches the output spot.
// Bits are solitons present (1) or absent (0); output 1 = a soliton at the output spot at the end.
import * as R from '../src/rule';
import { STARTER_STAMPS, boostStamp } from '../src/stamps';
import { makeLab, log, saveFrame } from './lab';

interface Spot { x: number; y: number; power: number }
function spots(state: Float32Array, N: number, S4: number, thr = 1, r = 14): Spot[] {
  const I = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) I[i] = state[i * S4] ** 2 + state[i * S4 + 1] ** 2;
  const at = (x: number, y: number) => I[((y + N) % N) * N + ((x + N) % N)];
  const out: Spot[] = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = I[y * N + x];
    if (v < thr) continue;
    let max = true;
    for (let dy = -4; dy <= 4 && max; dy++) for (let dx = -4; dx <= 4; dx++) if ((dx || dy) && at(x + dx, y + dy) > v) { max = false; break; }
    if (!max) continue;
    let p = 0, sx = 0, sy = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) { const w = at(x + dx, y + dy); p += w; sx += w * dx; sy += w * dy; }
    if (!out.some((o) => Math.hypot(o.x - x, o.y - y) < r)) out.push({ x: x + sx / p, y: y + sy / p, power: p });
  }
  return out;
}

export interface NandCfg {
  N?: number; h?: number; k?: number; d?: number; L?: number;
  /** C: heading (degrees anticlockwise from east), wavenumber, phase */
  cHead?: number; cK?: number; cPhase?: number; cLate?: number;
  tail?: number; cases?: string[]; frames?: boolean;
}

export default async function (cfg: NandCfg) {
  const N = cfg.N ?? 512, h = ((cfg.h ?? 15) * Math.PI) / 180, k = cfg.k ?? 0.08, d = cfg.d ?? 110, L = cfg.L ?? 120;
  const cHead = ((cfg.cHead ?? 120) * Math.PI) / 180, cK = cfg.cK ?? 0.04;
  const base = STARTER_STAMPS.find((s) => s.id === 'nls-soliton-0-still')!;
  const P1 = { x: 150, y: N / 2 }, P2 = { x: 150 + L, y: N / 2 };
  for (const bits of cfg.cases ?? ['00', '01', '10', '11']) {
    const lab = await makeLab(R.SATURABLE_NLS, N);
    const S4 = lab.layout.S * 4, per = lab.globals.timestep / lab.globals.dx ** 2; // cells per step per unit k
    const v = k * per, vc = cK * per;
    const tMeet = d / v + L / (0.96 * v) + (cfg.cLate ?? 0); // when the merged soliton reaches P2
    const D = vc * tMeet;
    // headings are anticlockwise from east with y up; the screen's y points down
    const put = (x: number, y: number, head: number, kk: number, ph: number) =>
      lab.place(boostStamp(base, ph, kk * Math.cos(head), -kk * Math.sin(head), 's', 's'), x, y);
    if (bits[0] === '1') await put(P1.x - d * Math.cos(h), P1.y + d * Math.sin(h), h, k, 0);
    if (bits[1] === '1') await put(P1.x - d * Math.cos(h), P1.y - d * Math.sin(h), -h, k, 0);
    const c0 = { x: P2.x - D * Math.cos(cHead), y: P2.y + D * Math.sin(cHead) };
    await put(c0.x, c0.y, cHead, cK, cfg.cPhase ?? 0);
    const tail = cfg.tail ?? 3000, T = Math.round(tMeet + tail);
    const out = { x: P2.x + vc * tail * Math.cos(cHead), y: P2.y - vc * tail * Math.sin(cHead) };
    if (cfg.frames) {
      for (const [i, t] of [0, Math.round(tMeet * 0.5), Math.round(tMeet), T].entries()) {
        await lab.run(t - (i ? [0, Math.round(tMeet * 0.5), Math.round(tMeet), T][i - 1] : 0));
        await saveFrame(`nand-${bits}-${i}.png`, lab, { ri: 2, lo: 0, hi: 6, scale: 1, caption: `A=${bits[0]} B=${bits[1]} t=${t}` });
      }
    } else await lab.run(T);
    const s = spots((await lab.read()).state, N, S4);
    const hit = s.filter((p) => Math.hypot(p.x - out.x, p.y - out.y) < 12);
    log(`A=${bits[0]} B=${bits[1]}: output ${hit.length ? `1 (power ${hit[0].power.toFixed(0)}, ${Math.hypot(hit[0].x - out.x, hit[0].y - out.y).toFixed(1)} cells off)` : '0'}   [C start (${c0.x.toFixed(0)},${c0.y.toFixed(0)}), output spot (${out.x.toFixed(0)},${out.y.toFixed(0)}), t=${T}; solitons: ${s.map((p) => `(${p.x.toFixed(0)},${p.y.toFixed(0)}) ${p.power.toFixed(0)}`).join(' ')}]`);
  }
}
