// Pentagram glider track (spectral mode): in the isotropic medium a line3
// reflector at 28–30° throws the glider back by ~144°, and five 144° turns
// close a five-pointed star. Each reflector's input lane (offset `lane` in
// its own frame) is the previous one's exit line (heading +tau, passing
// `miss` px from its centre), `ell` px further on.
import * as R from '../src/rule';
import { rotateStampBy } from '../src/stamps';
import { makeLab, runAll, blobs, log, saveFrame, STARTERS, HW_STD, type Lab } from './lab';
import { clusterPts } from './reflect-ring';

export function star(ell: number, cx: number, cy: number, o: { tau?: number; miss?: number; lane?: number; ang?: number; n?: number } = {}) {
  const tau = ((o.tau ?? -144) * Math.PI) / 180, miss = o.miss ?? 19.8, lane = o.lane ?? -4, n = o.n ?? 5;
  const C: number[][] = [[0, 0]], H: number[] = [0];
  for (let i = 1; i < n; i++) {
    const h = H[i - 1] + tau, u = [Math.cos(h), Math.sin(h)];
    const p = C[i - 1];
    C.push([p[0] + miss * u[1] + ell * u[0] - lane * -u[1], p[1] - miss * u[0] + ell * u[1] - lane * u[0]]);
    H.push(h);
  }
  const mx = C.reduce((a, p) => a + p[0], 0) / n, my = C.reduce((a, p) => a + p[1], 0) / n;
  const centres = C.map(([x, y]) => [cx + x - mx, cy + y - my]);
  const pts: number[][] = [];
  centres.forEach(([x, y], i) => clusterPts('line3', (o.ang ?? 30) + (H[i] * 180) / Math.PI).forEach(([dx, dy]) => pts.push([x + dx, y + dy])));
  // glider on reflector 0's lane (heading 0), `run` px before its leftmost soliton
  return { centres, heads: H, pts, lane0: centres[0][1] + lane };
}

export default async function (cfg: { ells?: number[]; tau?: number; miss?: number; lane?: number; ang?: number; run?: number; N?: number; steps?: number; frames?: boolean }) {
  const N = cfg.N ?? 256, rule = { ...R.GS_HISTORY_WAVE, laplacian: 'spectral' as const };
  const runs: { ell: number; lab: Lab; s: ReturnType<typeof star>; hits: number[]; seen: Set<number>; last: number }[] = [];
  for (const ell of cfg.ells ?? [150, 160, 170, 180]) {
    const l = await makeLab(rule, N, HW_STD);
    const s = star(ell, N / 2, N / 2, cfg);
    for (const [x, y] of s.pts) await l.place(STARTERS('starter-soliton-hw65'), x, y);
    runs.push({ ell, lab: l, s, hits: [], seen: new Set(), last: -1 });
  }
  await runAll(runs.map((r) => r.lab), 4000);
  for (const r of runs) {
    const x0 = Math.min(...r.s.pts.slice(0, 3).map((p) => p[0])) - (cfg.run ?? 60);
    await r.lab.place(rotateStampBy(STARTERS('starter-glider-hw65'), 0), x0, r.s.lane0);
  }
  // count reflections: the glider's nearest reflector, logged each time it changes
  let f = 0;
  for (let t = 1000; t <= (cfg.steps ?? 120000); t += 1000) {
    await runAll(runs.map((r) => r.lab), 1000);
    for (const r of runs) {
      const g = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2).filter((q) => !r.s.pts.some(([x, y]) => Math.hypot(q.x - x, q.y - y) < 6));
      if (g.length !== 1) continue;
      const d = r.s.centres.map(([x, y]) => { let dx = g[0].x - x, dy = g[0].y - y; dx -= Math.round(dx / N) * N; dy -= Math.round(dy / N) * N; return Math.hypot(dx, dy); });
      const i = d.indexOf(Math.min(...d));
      if (d[i] < 40 && i !== r.last) { r.hits.push(i); r.last = i; }
    }
    if (cfg.frames) await saveFrame(`f${String(f++).padStart(4, '0')}.png`, runs[0].lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 2, caption: `pentagram track  t=${t}` });
    if (t % 20000 === 0) log(`t=${t}: ${runs.map((r) => `ℓ${r.ell} hits ${r.hits.join('')}`).join('  ')}`);
  }
  const out = [];
  for (const r of runs) {
    const after = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2);
    const intact = r.s.pts.filter(([x, y]) => after.some((q) => Math.hypot(q.x - x, q.y - y) < 5)).length;
    // reflections in star order (0 → 1 → 2 …)
    let good = 0;
    for (let k = 1; k < r.hits.length; k++) if (r.hits[k] === (r.hits[k - 1] + 1) % 5) good++; else break;
    log(`ℓ ${r.ell}: ${intact}/15 intact, ${after.length - intact} movers; reflector sequence ${r.hits.join(' ')} → ${good + (r.hits[0] === 0 ? 1 : 0)} reflections in order (${((good + 1) / 5).toFixed(1)} laps)`);
    await saveFrame(`star-${r.ell}.png`, r.lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 2, caption: `pentagram ℓ ${r.ell}: ${r.hits.join(' ')}` });
    out.push({ ell: r.ell, intact, hits: r.hits, centres: r.s.centres });
    r.lab.sim.destroy();
  }
  return out;
}
