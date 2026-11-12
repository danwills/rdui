// Gliders against walls made of still solitons: spacing s, tilt θ (0 =
// perpendicular to the glider), glider lateral offset. Looks for reflections
// that leave the wall intact.
import { GS_HISTORY_WAVE } from '../src/rule';
import { stampFromJSON } from '../src/stamps';
import { makeLab, runAll, blobs, saveFrame, log, type Lab, type Blob } from './lab';

export default async function (cfg: { F?: number; k?: number; spacings?: number[]; tilts?: number[]; offsets?: number[]; n?: number; steps?: number; batch?: number }) {
  const N = 256, c = 128, g = { F: cfg.F ?? 0.054, k: cfg.k ?? 0.065 };
  const sol = stampFromJSON(await (await fetch('/lab/out/still-hit/soliton.json')).json());
  const gl = stampFromJSON(await (await fetch('/lab/out/still-hit/glider.json')).json());
  const n = cfg.n ?? 5;
  const jobs = (cfg.spacings ?? [18, 24]).flatMap((s) => (cfg.tilts ?? [0, 30, 45, 60]).flatMap((th) => (cfg.offsets ?? [-12, -9, -6, -3, 0, 3, 6, 9, 12]).map((off) => ({ s, th, off }))));
  const results: Record<string, unknown>[] = [];
  const batch = cfg.batch ?? 12, steps = cfg.steps ?? 9000;
  for (let j = 0; j < jobs.length; j += batch) {
    const runs: { s: number; th: number; off: number; lab: Lab; wall: { x: number; y: number }[] }[] = [];
    for (const job of jobs.slice(j, j + batch)) {
      const l = await makeLab(GS_HISTORY_WAVE, N, g);
      const a = (job.th * Math.PI) / 180;
      const wall = Array.from({ length: n }, (_, i) => ({ x: c + 20 + (i - (n - 1) / 2) * job.s * Math.sin(a), y: c + (i - (n - 1) / 2) * job.s * Math.cos(a) }));
      for (const p of wall) l.place(sol, p.x, p.y);
      l.place(gl, c - 70, c + job.off);
      runs.push({ ...job, lab: l, wall });
    }
    await runAll(runs.map((r) => r.lab), steps - 800);
    const before = await Promise.all(runs.map(async (r) => blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2)));
    await runAll(runs.map((r) => r.lab), 800);
    for (const [i, r] of runs.entries()) {
      const after = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2);
      const movers: number[] = [];
      let stills = 0;
      for (const q of after) {
        const p = before[i].reduce((m: Blob, o) => (Math.hypot(o.x - q.x, o.y - q.y) < Math.hypot(m.x - q.x, m.y - q.y) ? o : m), before[i][0] ?? q);
        if (Math.hypot(q.x - p.x, q.y - p.y) < 6) stills++; // gliders move ~14 px per 800 steps
        else movers.push(Math.round((Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI));
      }
      // wall intact: every original soliton still has a still blob within 4 px
      const intact = r.wall.every((w) => after.some((q) => Math.hypot(q.x - w.x, q.y - w.y) < 4));
      const kind = intact && movers.length === 1 && stills === n && Math.abs(movers[0]) > 15 ? 'REFLECT' : intact && movers.length === 0 && stills === n ? 'eat' : intact && movers.length === 1 && stills === n ? 'pass' : `broken`;
      const rec = { s: r.s, th: r.th, off: r.off, kind, movers, stills };
      results.push(rec);
      log(`s=${r.s} θ=${String(r.th).padStart(2)} off=${String(r.off).padStart(3)}: ${kind.padEnd(7)} movers ${movers.map((m) => m + '°').join(',') || '-'} stills ${stills}/${n}`);
      if (kind === 'REFLECT') await saveFrame(`reflect-s${r.s}-t${r.th}-o${r.off}.png`, r.lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 1, caption: `s=${r.s} θ=${r.th} off=${r.off}` });
      r.lab.sim.destroy();
    }
  }
  return results;
}
