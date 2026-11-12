// Kick catalogue: a glider passes a still soliton at impact distance b.
// Measure the soliton's displacement and what happens to the glider.
import { GS_HISTORY_WAVE } from '../src/rule';
import { makeLab, runAll, blobs, log, STARTERS, type Lab } from './lab';

export default async function (cfg: { F?: number; k?: number; bs?: number[]; steps?: number }) {
  const N = 192, c = 96, g = { F: cfg.F ?? 0.052, k: cfg.k ?? 0.066 };
  const bs = cfg.bs ?? Array.from({ length: 21 }, (_, i) => 6 + i);
  const runs: { b: number; lab: Lab }[] = [];
  for (const b of bs) {
    const l = await makeLab(GS_HISTORY_WAVE, N, g);
    await l.place(STARTERS('starter-soliton-hw65'), c, c);
    await l.place(STARTERS('starter-glider-hw65'), c - 70, c - b);
    runs.push({ b, lab: l });
  }
  await runAll(runs.map((r) => r.lab), 2000);
  const s0 = await Promise.all(runs.map(async (r) => blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2).find((q) => Math.hypot(q.x - c, q.y - c) < 5)));
  const steps = cfg.steps ?? 11000;
  await runAll(runs.map((r) => r.lab), steps - 600);
  const mid = await Promise.all(runs.map(async (r) => blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2)));
  await runAll(runs.map((r) => r.lab), 600);
  const out: Record<string, unknown> = {};
  for (const [i, r] of runs.entries()) {
    const after = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2);
    const parts = after.map((q) => {
      const p = mid[i].reduce((m, o) => (Math.hypot(o.x - q.x, o.y - q.y) < Math.hypot(m.x - q.x, m.y - q.y) ? o : m), mid[i][0] ?? q);
      const mv = Math.hypot(q.x - p.x, q.y - p.y);
      return mv < 3 ? { still: true, x: q.x, y: q.y } : { still: false, heading: Math.round((Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI) };
    });
    const st = parts.filter((p) => p.still) as { x: number; y: number }[];
    const mv = parts.filter((p) => !p.still) as { heading: number }[];
    const sol = s0[i];
    const kick = st.length === 1 && sol ? `soliton moved (${(st[0].x - sol.x).toFixed(1)}, ${(st[0].y - sol.y).toFixed(1)})` : `${st.length} stills`;
    out[r.b] = { kick, gliders: mv.map((m) => m.heading) };
    log(`b=${String(r.b).padStart(2)}: ${kick}; glider${mv.length === 1 ? '' : 's'} ${mv.map((m) => m.heading + '°').join(',') || 'gone'}`);
    r.lab.sim.destroy();
  }
  return out;
}
