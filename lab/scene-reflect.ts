// Scene version of the line3 reflector: cluster and glider placed together
// at t=0 (as the app does); which glider start x reflects?
import { GS_HISTORY_WAVE } from '../src/rule';
import { makeLab, runAll, blobs, log, STARTERS, type Lab } from './lab';

export default async function (cfg: { xs?: number[] }) {
  const N = 256, c = 128, g = { F: 0.052, k: 0.066 }, D = 25, a = Math.PI / 6;
  const xs = cfg.xs ?? [61.35, 50, 40, 30, 20, 10, 0, -10, -20, -30];
  const runs: { x: number; lab: Lab }[] = [];
  for (const x of xs) {
    const l = await makeLab(GS_HISTORY_WAVE, N, g);
    for (const t of [-D, 0, D]) await l.place(STARTERS('starter-soliton-hw65'), c + t * Math.cos(a), c + t * Math.sin(a));
    await l.place(STARTERS('starter-glider-hw65'), x, c - 4);
    runs.push({ x, lab: l });
  }
  await runAll(runs.map((r) => r.lab), 3000);
  for (let t = 0; t < 4; t++) {
    await runAll(runs.map((r) => r.lab), 3000);
  }
  const mid = await Promise.all(runs.map(async (r) => blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2)));
  await runAll(runs.map((r) => r.lab), 600);
  for (const [i, r] of runs.entries()) {
    const after = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2);
    const mv = after.map((q) => { const p = mid[i].reduce((m, o) => (Math.hypot(o.x - q.x, o.y - q.y) < Math.hypot(m.x - q.x, m.y - q.y) ? o : m)); return Math.hypot(q.x - p.x, q.y - p.y) > 2.5 ? Math.round((Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI) : null; }).filter((h) => h !== null);
    log(`glider start x=${r.x}: ${after.length - mv.length} still, movers ${mv.join(',') || 'none'}`);
    r.lab.sim.destroy();
  }
}
