// Two-reflector turn: reflector A (line3 @30°, glider lane −4) turns 0°→~46°;
// reflector B is A's layout rotated by the measured outgoing heading, placed on
// A's outgoing line. Scan B's sideways offset and distance.
import { GS_HISTORY_WAVE } from '../src/rule';
import { makeLab, runAll, blobs, saveFrame, log, STARTERS, type Lab } from './lab';
import { clusterPts } from './reflect-ring';

export default async function (cfg: { head?: number; through?: [number, number]; side?: number[]; dist?: number[]; steps?: number; noB?: boolean; bAng?: number; g?: Record<string, number> }) {
  const N = 512, g = cfg.g ?? { F: 0.052, k: 0.066 }, A: [number, number] = [150, 150];
  const th = ((cfg.head ?? 46.2) * Math.PI) / 180, P0 = cfg.through ?? [81.0, 101.1];
  const u = [Math.cos(th), Math.sin(th)], n = [-Math.sin(th), Math.cos(th)];
  const ptsA = clusterPts('line3', 30);
  const jobs = (cfg.side ?? [-4, -3, -2, -1, 0, 1, 2, 3, 4]).flatMap((s) => (cfg.dist ?? [90]).map((d) => ({ s, d })));
  const runs: { s: number; d: number; lab: Lab; B: [number, number]; n0: number }[] = [];
  for (const j of jobs) {
    const l = await makeLab(GS_HISTORY_WAVE, N, g);
    for (const [x, y] of ptsA) await l.place(STARTERS('starter-soliton-hw65'), A[0] + x, A[1] + y);
    // in A's frame the lane is y = −4, so B's centre sits 4 px to the lane's +n side, plus the scanned shift
    const B: [number, number] = [A[0] + P0[0] + j.d * u[0] + (4 + j.s) * n[0], A[1] + P0[1] + j.d * u[1] + (4 + j.s) * n[1]];
    if (!cfg.noB) for (const [x, y] of clusterPts('line3', cfg.bAng ?? 30 + (th * 180) / Math.PI)) await l.place(STARTERS('starter-soliton-hw65'), B[0] + x, B[1] + y);
    runs.push({ ...j, lab: l, B, n0: 6 });
  }
  await runAll(runs.map((r) => r.lab), 4000);
  const home = await Promise.all(runs.map(async (r) => blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2)));
  for (const r of runs) await r.lab.place(STARTERS('starter-glider-hw65'), A[0] + Math.min(...ptsA.map((p) => p[0])) - 45, A[1] - 4);
  await runAll(runs.map((r) => r.lab), (cfg.steps ?? 26000) - 1000);
  const mid = await Promise.all(runs.map(async (r) => blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2)));
  await runAll(runs.map((r) => r.lab), 1000);
  const res = [];
  for (const [i, r] of runs.entries()) {
    const after = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2);
    const intact = home[i].filter((h) => after.some((q) => Math.hypot(q.x - h.x, q.y - h.y) < 4)).length;
    const movers = after.filter((q) => !home[i].some((h) => Math.hypot(q.x - h.x, q.y - h.y) < 4)).map((q) => {
      const p = mid[i].reduce((m, o) => (Math.hypot(o.x - q.x, o.y - q.y) < Math.hypot(m.x - q.x, m.y - q.y) ? o : m));
      return { h: (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI, x: q.x, y: q.y };
    });
    const nS = cfg.noB ? 3 : 6;
    const tag = intact === nS && movers.length === 1 ? `TURN → ${movers[0].h.toFixed(0)}°` : `${intact}/${nS} solitons, ${movers.length} movers ${movers.map((m) => m.h.toFixed(0) + '°').join(',')}`;
    log(`B ${cfg.bAng ?? 'auto'}° side ${r.s >= 0 ? '+' : ''}${r.s}, dist ${r.d}: ${tag}`);
    res.push({ s: r.s, d: r.d, tag, B: r.B });
    await saveFrame(`side${r.s}-d${r.d}.png`, r.lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 1, caption: `B side ${r.s}: ${tag}` });
    r.lab.sim.destroy();
  }
  return res;
}
