// Scene version of the 90° turn: clusters and glider all placed at t=0 (as the
// app does). Scan the glider's start x along its lane; which still turn 90°?
import { GS_HISTORY_WAVE } from '../src/rule';
import { makeLab, runAll, blobs, log, STARTERS, HW_STD, type Lab } from './lab';
import { clusterPts } from './reflect-ring';

export default async function (cfg: { dxs?: number[]; bAng?: number; side?: number; dist?: number; steps?: number }) {
  const N = 512, A: [number, number] = [150, 150], th = (48.0 * Math.PI) / 180;
  const u = [Math.cos(th), Math.sin(th)], n = [-Math.sin(th), Math.cos(th)], d = cfg.dist ?? 85, s = cfg.side ?? -2;
  const B: [number, number] = [A[0] + 67.7 + d * u[0] + (4 + s) * n[0], A[1] + 91.7 + d * u[1] + (4 + s) * n[1]];
  const ptsA = clusterPts('line3', 30), ptsB = clusterPts('line3', cfg.bAng ?? 70);
  const x0 = A[0] + Math.min(...ptsA.map((p) => p[0])) - 45;
  const runs: { dx: number; lab: Lab }[] = [];
  for (const dx of cfg.dxs ?? [0, -2, -4, -6, -8, -10, -12, -14]) {
    const l = await makeLab(GS_HISTORY_WAVE, N, HW_STD);
    for (const [x, y] of ptsA) await l.place(STARTERS('starter-soliton-hw65'), A[0] + x, A[1] + y);
    for (const [x, y] of ptsB) await l.place(STARTERS('starter-soliton-hw65'), B[0] + x, B[1] + y);
    await l.place(STARTERS('starter-glider-hw65'), x0 + dx, A[1] - 4);
    runs.push({ dx, lab: l });
  }
  const T = cfg.steps ?? 34000;
  await runAll(runs.map((r) => r.lab), T - 1000);
  const mid = await Promise.all(runs.map(async (r) => blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2)));
  await runAll(runs.map((r) => r.lab), 1000);
  const homes = [...ptsA.map(([x, y]) => [A[0] + x, A[1] + y]), ...ptsB.map(([x, y]) => [B[0] + x, B[1] + y])];
  const out = [];
  for (const [i, r] of runs.entries()) {
    const after = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2);
    const intact = homes.filter(([x, y]) => after.some((q) => Math.hypot(q.x - x, q.y - y) < 5)).length;
    const mv = after.filter((q) => !homes.some(([x, y]) => Math.hypot(q.x - x, q.y - y) < 5)).map((q) => {
      const p = mid[i].reduce((m, o) => (Math.hypot(o.x - q.x, o.y - q.y) < Math.hypot(m.x - q.x, m.y - q.y) ? o : m));
      return `${((Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI).toFixed(0)}° at (${q.x.toFixed(0)},${q.y.toFixed(0)})`;
    });
    log(`glider x ${(x0 + r.dx).toFixed(1)} (dx ${r.dx}): ${intact}/6 intact, movers ${mv.join(', ') || 'none'}`);
    out.push({ dx: r.dx, x: x0 + r.dx, intact, mv });
    r.lab.sim.destroy();
  }
  return out;
}
