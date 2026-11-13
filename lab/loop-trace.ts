// Trace the glider leaving a two-reflector 90° turn (A line3@30°, B line3@bAng)
// over a long run, to fit its outgoing line for chaining turns into a loop.
import { GS_HISTORY_WAVE } from '../src/rule';
import { makeLab, runAll, blobs, log, STARTERS, HW_STD } from './lab';
import { clusterPts } from './reflect-ring';

export default async function (cfg: { bAng?: number; side?: number; dist?: number; head?: number; through?: [number, number]; N?: number; chunks?: number }) {
  const N = cfg.N ?? 768, A: [number, number] = [150, 150];
  const th = ((cfg.head ?? 48.0) * Math.PI) / 180, P0 = cfg.through ?? [67.7, 91.7];
  const u = [Math.cos(th), Math.sin(th)], n = [-Math.sin(th), Math.cos(th)];
  const d = cfg.dist ?? 85, s = cfg.side ?? -2;
  const l = await makeLab(GS_HISTORY_WAVE, N, HW_STD);
  const ptsA = clusterPts('line3', 30);
  const B: [number, number] = [A[0] + P0[0] + d * u[0] + (4 + s) * n[0], A[1] + P0[1] + d * u[1] + (4 + s) * n[1]];
  const ptsB = clusterPts('line3', cfg.bAng ?? 70);
  for (const [x, y] of ptsA) await l.place(STARTERS('starter-soliton-hw65'), A[0] + x, A[1] + y);
  for (const [x, y] of ptsB) await l.place(STARTERS('starter-soliton-hw65'), B[0] + x, B[1] + y);
  await runAll([l], 4000);
  const home = blobs((await l.read()).state, N, l.layout.S, 1, 0.2);
  const g0: [number, number] = [A[0] + Math.min(...ptsA.map((p) => p[0])) - 45, A[1] - 4];
  await l.place(STARTERS('starter-glider-hw65'), g0[0], g0[1]);
  const path: [number, number, number][] = [];
  for (let t = 1; t <= (cfg.chunks ?? 140); t++) {
    await runAll([l], 1000);
    const bs = blobs((await l.read()).state, N, l.layout.S, 1, 0.2).filter((b) => !home.some((h) => Math.hypot(b.x - h.x, b.y - h.y) < 6));
    if (bs.length === 1) path.push([t * 1000, bs[0].x, bs[0].y]);
  }
  // keep points well past B (beyond 60 px), fit x = a + b·y
  const far = path.filter(([, , y]) => y > B[1] + 60 && y < N - 20);
  const my = far.reduce((m, p) => m + p[2], 0) / far.length, mx = far.reduce((m, p) => m + p[1], 0) / far.length;
  const b = far.reduce((m, p) => m + (p[2] - my) * (p[1] - mx), 0) / far.reduce((m, p) => m + (p[2] - my) ** 2, 0);
  const res = far.map(([, x, y]) => x - (mx + b * (y - my)));
  const speed = far.length > 1 ? Math.hypot(far.at(-1)![1] - far[0][1], far.at(-1)![2] - far[0][2]) / (far.at(-1)![0] - far[0][0]) * 1000 : 0;
  log(`bAng ${cfg.bAng ?? 70} side ${s} dist ${d}: ${far.length} far points, heading ${(90 - (Math.atan(b) * 180) / Math.PI).toFixed(2)}°, x at y=A+300: ${(mx + b * (A[1] + 300 - my) - A[0]).toFixed(2)} rel A, max resid ${Math.max(...res.map(Math.abs)).toFixed(2)} px, speed ${speed.toFixed(2)} px/k`);
  log(`  glider launched at (${g0[0] - A[0]}, ${g0[1] - A[1]}) rel A, lane y=−4; B at (${(B[0] - A[0]).toFixed(1)}, ${(B[1] - A[1]).toFixed(1)})`);
  log(`  path: ${path.filter((_, i) => i % 10 === 0).map(([t, x, y]) => `${t / 1000}k:(${(x - A[0]).toFixed(1)},${(y - A[1]).toFixed(1)})`).join(' ')}`);
  l.sim.destroy();
  return { path, B, slope: b, mx, my };
}
