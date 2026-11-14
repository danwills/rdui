// Can a still soliton (or a small cluster) capture a passing glider into an
// orbit — a glider "moon", the smallest glider oscillator? Launch the glider
// past the target at impact distances b; classify each run as absorbed,
// escaped, or bound (still circling near the target at the end).
import * as R from '../src/rule';
import { makeLab, runAll, blobs, log, saveFrame, STARTERS, HW_STD, type Lab } from './lab';
import { clusterPts } from './reflect-ring';

export default async function (cfg: { targets?: string[]; bs?: number[]; ang?: number; mode?: 'stencil' | 'spectral'; g?: Record<string, number>; steps?: number; N?: number }) {
  const N = cfg.N ?? 256, c = N / 2, rule = { ...R.GS_HISTORY_WAVE, laplacian: cfg.mode ?? 'stencil' };
  const shapes: Record<string, number[][]> = { single: [[0, 0]], pair: clusterPts('pair', 90), line3: clusterPts('line3', 90), tri: [[0, -14.4], [-12.5, 7.2], [12.5, 7.2]] };
  const jobs = (cfg.targets ?? ['single', 'pair', 'tri']).flatMap((t) => (cfg.bs ?? [8, 12, 16, 20, 24, 28, 32, 36]).map((b) => ({ t, b })));
  const runs: { t: string; b: number; lab: Lab; pts: number[][]; trail: number[][] }[] = [];
  for (const j of jobs) {
    const l = await makeLab(rule, N, cfg.g ?? HW_STD);
    const pts = shapes[j.t].map(([x, y]) => [c + x, c + y]);
    for (const [x, y] of pts) await l.place(STARTERS('starter-soliton-hw65'), x, y);
    runs.push({ ...j, lab: l, pts, trail: [] });
  }
  await runAll(runs.map((r) => r.lab), 4000);
  for (const r of runs) await r.lab.place(STARTERS('starter-glider-hw65'), c - 80, c + r.b);
  for (let t = 1000; t <= (cfg.steps ?? 60000); t += 1000) {
    await runAll(runs.map((r) => r.lab), 1000);
    for (const r of runs) {
      const g = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2).filter((q) => !r.pts.some(([x, y]) => Math.hypot(q.x - x, q.y - y) < 6));
      r.trail.push(g.length === 1 ? [t, g[0].x, g[0].y] : [t, NaN, g.length]);
    }
  }
  const out = [];
  for (const r of runs) {
    const after = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2);
    const intact = r.pts.filter(([x, y]) => after.some((q) => Math.hypot(q.x - x, q.y - y) < 6)).length;
    const late = r.trail.slice(-25).filter((p) => !isNaN(p[1]));
    // winding of the glider around the centre over the run (unwrapped angle)
    let wind = 0, prev: number | null = null;
    for (const p of r.trail) {
      if (isNaN(p[1])) { prev = null; continue; }
      const a = Math.atan2(p[2] - c, p[1] - c);
      if (prev !== null) { let d = a - prev; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; wind += d; }
      prev = a;
    }
    const near = late.length ? Math.max(...late.map((p) => Math.hypot(p[1] - c, p[2] - c))) : NaN;
    const kind = !late.length ? 'absorbed / gone' : near < 70 && late.length >= 20 ? `BOUND (late radius ≤ ${near.toFixed(0)} px)` : 'escaped';
    log(`${r.t} b=${r.b}: ${kind}; winding ${((wind * 180) / Math.PI).toFixed(0)}°; target ${intact}/${r.pts.length} in place, ${after.length - intact} other blobs`);
    if (kind.startsWith('BOUND')) await saveFrame(`${r.t}-b${r.b}.png`, r.lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 2, caption: `${r.t} b=${r.b} ${kind}` });
    out.push({ t: r.t, b: r.b, kind, wind, intact });
    r.lab.sim.destroy();
  }
  return out;
}
