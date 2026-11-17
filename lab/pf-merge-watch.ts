// Phase-field Bubbles 3/4: two bubbles stamped `gap` cells apart grow into each other; logs phi, h (3) or u (4) and m across the gap's
// middle row as they meet, to see how a merge happens (or a gap holds).
//   node lab/run.mjs pf-merge-watch '{"gap":10,"m":5}'
import * as R from '../src/rule';
import { makeLab, log } from './lab';
export default async function (cfg: { gap: number; m: number; r?: number; rule?: string; set?: Record<string, number>; every?: number; steps?: number }) {
  const rule = (R as unknown as Record<string, typeof R.PF_BUBBLES_3>)[cfg.rule ?? 'PF_BUBBLES_3'];
  const N = 128, r = cfg.r ?? 16, lab = await makeLab(rule, N, cfg.set ?? {});
  const S4 = lab.layout.S * 4, ix = (n: string) => lab.layout.reagents.indexOf(n), { state } = await lab.read();
  const c1 = 64 - cfg.gap / 2 - r, c2 = 64 + cfg.gap / 2 + r;
  for (const cx of [c1, c2]) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
    if (Math.hypot(x - cx, y - 64) <= r) { const i = (y * N + x) * S4; state[i + ix('phi')] = 1; state[i + ix('m')] = cfg.m; }
  lab.sim.writeRegion(0, 0, N, N, undefined, state);
  const row = (s: Float32Array, k: string) => ix(k) < 0 ? '' : Array.from({ length: 13 }, (_, j) => s[(64 * N + 58 + j) * S4 + ix(k)].toFixed(2)).join(' ');
  for (let t = 0; t < (cfg.steps ?? 3000); ) {
    const dt = cfg.every ?? 200; await lab.run(dt); t += dt;
    const s = (await lab.read()).state;
    // where phi crosses a half on bubble 1's outer side and on its side facing the gap: u (or h) there
    const cross = (x0: number, dx: number) => { let x = x0; while (x > 0 && x < N - 1 && s[(64 * N + x) * S4 + ix('phi')] > 0.5) x += dx; return x; };
    const xo = cross(Math.round(c1), -1), xg = cross(Math.round(c1), 1), k = ix('u') >= 0 ? ix('u') : ix('h');
    log(`at the edge crossings: outer x ${xo} ${s[(64 * N + xo) * S4 + k].toFixed(2)}, facing the gap x ${xg} ${s[(64 * N + xg) * S4 + k].toFixed(2)}`);
    log(`t=${t}\n  phi ${row(s, 'phi')}\n  h   ${row(s, 'h')}\n  u   ${row(s, 'u')}\n  m   ${row(s, 'm')}`);
    if (s[(64 * N + 64) * S4 + ix('phi')] > 0.5) { log('merged'); break; }
  }
}
