// Seeds grown here (src/seeds.ts) vs the Python original: each chemical's mean and spread.
//   node lab/run.mjs seed-check '{"picks":{"kind":[[md5,[w,h]],...]}}'
import { growSeed, loadSeed } from '../src/seeds';
import { log } from './lab';
export default async function (cfg: { picks: Record<string, [string, [number, number]][]> }) {
  for (const [kind, list] of Object.entries(cfg.picks)) for (const [md5, [w, h]] of list) {
    const seed = await loadSeed(md5);
    if (!seed) { log(`${kind} ${md5}: no seed`); continue; }
    const t0 = performance.now();
    const g = growSeed(seed, w, h);
    const ms = performance.now() - t0;
    log(`TS ${kind} ${md5} ${w}x${h} ${ms.toFixed(0)}ms ` + g.map((a, c) => {
      let s = 0, s2 = 0, bad = 0;
      for (const v of a) { if (!Number.isFinite(v)) { bad++; continue; } s += v; s2 += v * v; }
      const m = s / a.length;
      return `${seed.names[c]} ${m.toPrecision(4)}±${Math.sqrt(Math.max(0, s2 / a.length - m * m)).toPrecision(3)}${bad ? ` NaN${bad}` : ''}`;
    }).join(' '));
  }
}
