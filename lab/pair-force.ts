// Soliton pair interaction: drift of the separation vs distance. A sign
// change from + (apart) to − (together) is a stable bond distance.
import { GS_HISTORY_WAVE } from '../src/rule';
import { makeLab, runAll, blobs, log, STARTERS, type Lab } from './lab';

export default async function (cfg: { media?: Record<string, number>[]; ds?: number[]; steps?: number }) {
  const N = 128, c = 64, steps = cfg.steps ?? 20000;
  const media = cfg.media ?? [{ F: 0.052, k: 0.066 }, { F: 0.05, k: 0.066 }, { F: 0.054, k: 0.065 }, { F: 0.05, k: 0.065 }];
  const ds = cfg.ds ?? [14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36];
  const out: Record<string, unknown> = {};
  for (const g of media) {
    const runs: { d: number; lab: Lab }[] = [];
    for (const d of ds) {
      const l = await makeLab(GS_HISTORY_WAVE, N, g);
      await l.place(STARTERS('starter-soliton-hw65'), c - d / 2, c);
      await l.place(STARTERS('starter-soliton-hw65'), c + d / 2, c);
      runs.push({ d, lab: l });
    }
    await runAll(runs.map((r) => r.lab), 3000); // let the stamps settle
    const d0 = await Promise.all(runs.map(async (r) => { const b = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2); return b.length === 2 ? Math.hypot(b[0].x - b[1].x, b[0].y - b[1].y) : NaN; }));
    await runAll(runs.map((r) => r.lab), steps);
    const row: string[] = [];
    for (const [i, r] of runs.entries()) {
      const b = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2);
      const d1 = b.length === 2 ? Math.hypot(b[0].x - b[1].x, b[0].y - b[1].y) : NaN;
      const v = ((d1 - d0[i]) / steps) * 100000;
      row.push(`${d0[i].toFixed(1)}→${Number.isNaN(d1) ? `${b.length}blobs` : `${d1.toFixed(1)} (${v >= 0 ? '+' : ''}${v.toFixed(1)})`}`);
      r.lab.sim.destroy();
    }
    out[`${g.F}/${g.k}`] = row;
    log(`F=${g.F} k=${g.k}  separation start→end (drift px per 100k):\n   ${row.join('\n   ')}`);
  }
  return out;
}
