// Scene version of the glider loop: corners and glider all placed at t=0 (as
// the app does). Scan the glider's run-in; count corners turned. Optionally
// write the winner to scenes/current.json (via the result file).
import { GS_HISTORY_WAVE } from '../src/rule';
import { makeLab, runAll, blobs, log, STARTERS, HW_STD, type Lab } from './lab';
import { corners } from './loop';

export default async function (cfg: { runIn?: number[]; L?: number; across?: number; bAng?: number; N?: number; steps?: number }) {
  const N = cfg.N ?? 768, L = cfg.L ?? 441, ac = cfg.across ?? 110, bA = cfg.bAng ?? 72;
  const runs: { ri: number; lab: Lab; c: ReturnType<typeof corners>; heads: number[]; last: number[] | null }[] = [];
  for (const ri of cfg.runIn ?? [166, 168, 170, 172, 174, 176, 178, 180]) {
    const l = await makeLab(GS_HISTORY_WAVE, N, HW_STD);
    const c = corners(L, N / 2, N / 2, 4, ac, bA);
    for (const [j, [x, y]] of c.pts.entries()) await l.place(STARTERS('starter-soliton-hw65'), x, y, { rot: c.rots[j] });
    await l.place(STARTERS('starter-glider-hw65'), c.glider[0] - ri, c.glider[1]);
    runs.push({ ri, lab: l, c, heads: [], last: null });
  }
  // count quarter turns: the axis heading (0, 90, 180, 270) the glider is on, sampled every 4k steps
  for (let t = 4000; t <= (cfg.steps ?? 300000); t += 4000) {
    await runAll(runs.map((r) => r.lab), 4000);
    for (const r of runs) {
      const g = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2).filter((b) => !r.c.pts.some(([x, y]) => Math.hypot(b.x - x, b.y - y) < 6));
      if (g.length !== 1) { r.last = null; continue; }
      if (r.last) {
        let dx = g[0].x - r.last[0], dy = g[0].y - r.last[1];
        dx -= Math.round(dx / N) * N; dy -= Math.round(dy / N) * N;
        const h = (Math.round(Math.atan2(dy, dx) / (Math.PI / 2)) * 90 + 360) % 360;
        if (Math.hypot(dx, dy) > 40 && Math.abs(Math.atan2(dy, dx) * 180 / Math.PI - (h > 180 ? h - 360 : h)) < 8 && r.heads.at(-1) !== h) r.heads.push(h);
      }
      r.last = [g[0].x, g[0].y];
    }
  }
  const out = [];
  for (const r of runs) {
    const after = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2);
    const intact = r.c.pts.filter(([x, y]) => after.some((q) => Math.hypot(q.x - x, q.y - y) < 5)).length;
    const alive = after.length - intact;
    log(`runIn ${r.ri}: ${intact}/24 intact, ${alive} movers at end; axis legs ${r.heads.join(' → ')} (${Math.max(0, r.heads.length - 1)} turns)`);
    out.push({ runIn: r.ri, intact, alive, heads: r.heads, pts: r.c.pts, rots: r.c.rots, glider: [r.c.glider[0] - r.ri, r.c.glider[1]] });
    r.lab.sim.destroy();
  }
  return out;
}
