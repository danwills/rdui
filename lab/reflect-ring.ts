// After a reflection: how much do the cluster's solitons ring, and how fast
// do they settle? Also fits the outgoing glider's line (for chaining).
import { GS_HISTORY_WAVE } from '../src/rule';
import { makeLab, runAll, blobs, log, STARTERS, type Lab } from './lab';

const D = 25;
const SHAPES: Record<string, [number, number][]> = {
  pair: [[-D / 2, 0], [D / 2, 0]],
  line3: [[-D, 0], [0, 0], [D, 0]],
  square: [[-D / 2, -D / 2], [D / 2, -D / 2], [-D / 2, D / 2], [D / 2, D / 2]],
};
export const clusterPts = (shape: string, ang: number) => { const a = (ang * Math.PI) / 180; return SHAPES[shape].map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]); };

export default async function (cfg: { cases?: { shape: string; ang: number; off: number }[]; g?: Record<string, number> }) {
  const N = 512, c = 256, g = cfg.g ?? { F: 0.052, k: 0.066 };
  const cases = cfg.cases ?? [{ shape: 'pair', ang: 30, off: 2 }, { shape: 'line3', ang: 30, off: -4 }, { shape: 'line3', ang: 30, off: -3 }, { shape: 'square', ang: 30, off: -10 }, { shape: 'square', ang: 60, off: -14 }, { shape: 'square', ang: 60, off: -15 }];
  const runs: { cs: (typeof cases)[0]; lab: Lab; home: { x: number; y: number }[]; ring: number[]; path: [number, number][] }[] = [];
  for (const cs of cases) {
    const l = await makeLab(GS_HISTORY_WAVE, N, g); const pts = clusterPts(cs.shape, cs.ang);
    for (const [x, y] of pts) await l.place(STARTERS('starter-soliton-hw65'), c + x, c + y);
    runs.push({ cs, lab: l, home: [], ring: [], path: [] });
  }
  await runAll(runs.map((r) => r.lab), 4000);
  for (const r of runs) {
    r.home = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2);
    const pts = clusterPts(r.cs.shape, r.cs.ang);
    await r.lab.place(STARTERS('starter-glider-hw65'), c + Math.min(...pts.map((p) => p[0])) - 45, c + r.cs.off);
  }
  for (let t = 0; t < 40; t++) {
    await runAll(runs.map((q) => q.lab), 500);
    for (const r of runs) {
      const bs = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2);
      const used = new Set<number>();
      let worst = 0;
      for (const h of r.home) { let bi = -1, bd = 1e9; bs.forEach((b, i) => { const d = Math.hypot(b.x - h.x, b.y - h.y); if (d < bd && !used.has(i) && b.area > 30) { bd = d; bi = i; } }); if (bi >= 0 && bd < 12) used.add(bi); worst = Math.max(worst, Math.min(bd, 99)); }
      r.ring.push(worst);
      const gl = bs.filter((_, i) => !used.has(i));
      if (gl.length === 1 && Math.hypot(gl[0].x - c, gl[0].y - c) > 45 && Math.hypot(gl[0].x - c, gl[0].y - c) < 200 && t > 6) r.path.push([gl[0].x, gl[0].y]);
    }
  }
  const out = [];
  for (const r of runs) {
    // outgoing line: fit from the last 8 glider positions
    if (r.path.length < 2) { log(`${r.cs.shape} ${r.cs.ang}° off ${r.cs.off}: glider never left (died or stalled)`); r.lab.sim.destroy(); continue; }
    const p = r.path.slice(0, 8);
    const [x0, y0] = p[0], [x1, y1] = p[p.length - 1];
    const head = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
    const peak = Math.max(...r.ring.slice(0, 30));
    const settle = r.ring.reduce((m, d, i) => (d > 0.6 ? i : m), -1) * 500;
    log(`${r.cs.shape} ${r.cs.ang}° off ${r.cs.off}: solitons moved up to ${peak.toFixed(1)} px, settled (<0.6 px) by t=${settle}; final ${r.ring.at(-1)!.toFixed(1)} px. Out: heading ${head.toFixed(1)}°, through (${(x1 - c).toFixed(1)}, ${(y1 - c).toFixed(1)}) rel. centre`);
    const ok = r.ring.slice(14).filter((d) => d < 20);
    log(`   ringing after hit: max ${Math.max(...ok).toFixed(1)} px, late mean ${(ok.slice(-12).reduce((a, b) => a + b, 0) / Math.max(1, ok.slice(-12).length)).toFixed(2)} px`);
    if (0) log(`   trace: ${r.ring.map((d) => (d > 50 ? "M" : d.toFixed(1))).join(" ")}`);
    out.push({ ...r.cs, peak, settle, head, through: [x1 - c, y1 - c] });
    r.lab.sim.destroy();
  }
  return out;
}
