// One three-soliton reflector in a chosen Laplacian mode (default spectral):
// scan its angle and the glider's lane, and fit the outgoing heading — for an
// octagonal track we want exactly 45° per reflector.
import * as R from '../src/rule';
import { makeLab, runAll, blobs, log, STARTERS, HW_STD, type Lab } from './lab';
import { clusterPts } from './reflect-ring';

export default async function (cfg: { angs?: number[]; offs?: number[]; shape?: string; mode?: 'stencil' | 'spectral'; N?: number; run?: number; steps?: number }) {
  const N = cfg.N ?? 256, c = N / 2, rule = { ...R.GS_HISTORY_WAVE, laplacian: cfg.mode ?? 'spectral' };
  const jobs = (cfg.angs ?? [24, 26, 28, 30]).flatMap((ang) => (cfg.offs ?? [-6, -5, -4, -3, -2]).map((off) => ({ ang, off })));
  const runs: { ang: number; off: number; lab: Lab; pts: number[][]; trail: number[][] }[] = [];
  for (const j of jobs) {
    const l = await makeLab(rule, N, HW_STD);
    const pts = clusterPts(cfg.shape ?? 'line3', j.ang).map(([x, y]) => [c + x, c + y]);
    for (const [x, y] of pts) await l.place(STARTERS('starter-soliton-hw65'), x, y);
    runs.push({ ...j, lab: l, pts, trail: [] });
  }
  await runAll(runs.map((r) => r.lab), 4000);
  for (const r of runs) await r.lab.place(STARTERS('starter-glider-hw65'), c + Math.min(...r.pts.map((p) => p[0] - c)) - (cfg.run ?? 70), c + r.off);
  for (let t = 1000; t <= (cfg.steps ?? 22000); t += 1000) {
    await runAll(runs.map((r) => r.lab), 1000);
    for (const r of runs) {
      const g = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2).filter((b) => !r.pts.some(([x, y]) => Math.hypot(b.x - x, b.y - y) < 6));
      if (g.length === 1) r.trail.push([t, g[0].x, g[0].y]);
    }
  }
  const out = [];
  for (const r of runs) {
    const after = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2);
    const intact = r.pts.filter(([x, y]) => after.some((q) => Math.hypot(q.x - x, q.y - y) < 4)).length;
    // outgoing: points 45–110 px from the cluster centre, after the closest approach, unwrapped
    const tr = r.trail, iMin = tr.reduce((m, p, i) => (Math.hypot(p[1] - c, p[2] - c) < Math.hypot(tr[m][1] - c, tr[m][2] - c) ? i : m), 0);
    const outP = tr.slice(iMin).filter((p) => { const d = Math.hypot(p[1] - c, p[2] - c); return d > 45 && d < 110; });
    let res = `no clean exit (${tr.length} sightings)`, head: number | null = null, inHead: number | null = null;
    if (tr.length > 3) inHead = (Math.atan2(tr[2][2] - tr[0][2], tr[2][1] - tr[0][1]) * 180) / Math.PI;
    const farP = tr.slice(iMin).filter((p) => { const d = Math.hypot(p[1] - c, p[2] - c); return d > 110 && d < N / 2 - 25; });
    let far = '';
    if (farP.length >= 3) {
      const [, fx0, fy0] = farP[0], [, fx1, fy1] = farP.at(-1)!;
      const fh = (Math.atan2(fy1 - fy0, fx1 - fx0) * 180) / Math.PI, ux = Math.cos((fh * Math.PI) / 180), uy = Math.sin((fh * Math.PI) / 180);
      far = `; far (110+ px): out ${fh.toFixed(2)}°, line ${((fx0 - c) * uy - (fy0 - c) * ux).toFixed(2)} px from centre`;
    }
    if (outP.length >= 3) {
      const [, x0, y0] = outP[0], [, x1, y1] = outP.at(-1)!;
      head = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
      // perpendicular distance of the exit line from the cluster centre (signed)
      const ux = Math.cos((head * Math.PI) / 180), uy = Math.sin((head * Math.PI) / 180);
      const miss = (x0 - c) * uy - (y0 - c) * ux;
      res = `turn ${(head - (inHead ?? 0)).toFixed(1)}° (in ${inHead?.toFixed(1)}°, out ${head.toFixed(1)}°), exit line passes ${miss.toFixed(1)} px from centre${far}`;
    }
    log(`ang ${r.ang}° lane ${r.off}: ${intact}/${r.pts.length} intact; ${res}`);
    out.push({ ang: r.ang, off: r.off, intact, head, inHead });
    r.lab.sim.destroy();
  }
  return out;
}
