// Which media hold both a stable lone soliton and a working glider?
import { GS_HISTORY_WAVE } from '../src/rule';
import { stampFromJSON } from '../src/stamps';
import { makeLab, runAll, blobs, log, STARTERS, type Lab } from './lab';

export default async function (cfg: { Fs?: number[]; ks?: number[]; steps?: number }) {
  const N = 192, c = 96;
  const sol = stampFromJSON(await (await fetch('/lab/out/soliton/soliton.json')).json());
  const media = (cfg.Fs ?? [0.05, 0.052, 0.054, 0.056]).flatMap((F) => (cfg.ks ?? [0.062, 0.063, 0.064, 0.065]).map((k) => ({ F, k })));
  const runs: { F: number; k: number; s: Lab; g: Lab; counts: number[]; gl: string[] }[] = [];
  for (const { F, k } of media) {
    const s = await makeLab(GS_HISTORY_WAVE, N, { F, k }); s.place(sol, c, c);
    const g = await makeLab(GS_HISTORY_WAVE, N, { F, k }); g.place(STARTERS('starter-glider-hw-axis'), 30, c);
    runs.push({ F, k, s, g, counts: [], gl: [] });
  }
  const steps = cfg.steps ?? 40000;
  let prev: { x: number; y: number }[] = runs.map(() => ({ x: 30, y: c }));
  for (let t = 5000; t <= steps; t += 5000) {
    await runAll(runs.flatMap((r) => [r.s, r.g]), 5000);
    for (const [i, r] of runs.entries()) {
      const sb = blobs((await r.s.read()).state, N, r.s.layout.S, 1, 0.2);
      r.counts.push(sb.length);
      const gb = blobs((await r.g.read()).state, N, r.g.layout.S, 1, 0.2);
      if (t <= 10000) {
        if (gb.length === 1) { r.gl.push(`${(Math.hypot(((gb[0].x - prev[i].x + N * 1.5) % N) - N / 2, gb[0].y - prev[i].y) / 5).toFixed(1)}`); prev[i] = gb[0]; }
        else r.gl.push(`${gb.length}blobs`);
      }
    }
  }
  for (const r of runs) log(`F=${r.F} k=${r.k}: soliton count every 5k: ${r.counts.join(' ')}   glider speed px/k: ${r.gl.join(' ')}`);
}
