// Glider-gun search: paint an emitter disk with different (F, k) into the
// glider medium, seed it, and look for disks that keep shedding moving blobs
// into the surrounding medium (absorbing border so nothing comes back).
import { GS_HISTORY_WAVE } from '../src/rule';
import { makeLab, runAll, absorber, paintDisk, seedDisk, blobs, log, type Lab } from './lab';

interface Run { F: number; k: number; r: number; lab: Lab; outside: number[]; inside: number[]; area: number[]; emissions: number; prev: { x: number; y: number }[] }

export default async function (cfg: { Fs?: number[]; ks?: number[]; rs?: number[]; steps?: number; every?: number; batch?: number; N?: number }) {
  const N = cfg.N ?? 256, steps = cfg.steps ?? 30000, every = cfg.every ?? 500, batch = cfg.batch ?? 12;
  const Fs = cfg.Fs ?? [0.02, 0.03, 0.04, 0.05, 0.06, 0.07];
  const ks = cfg.ks ?? [0.05, 0.054, 0.058, 0.062, 0.066];
  const rs = cfg.rs ?? [6, 10, 16];
  const jobs = Fs.flatMap((F) => ks.flatMap((k) => rs.map((r) => ({ F, k, r }))));
  const results: Record<string, unknown>[] = [];
  const c = N / 2;
  for (let j = 0; j < jobs.length; j += batch) {
    const runs: Run[] = [];
    for (const { F, k, r } of jobs.slice(j, j + batch)) {
      const lab = await makeLab(GS_HISTORY_WAVE, N);
      await absorber(lab, 12, { k: 0.072 });
      await paintDisk(lab, c, c, r, { F, k });
      await seedDisk(lab, c, c, 3, { a: 0.5, b: 0.4 });
      runs.push({ F, k, r, lab, outside: [], inside: [], area: [], emissions: 0, prev: [] });
    }
    for (let t = every; t <= steps; t += every) {
      await runAll(runs.map((x) => x.lab), every);
      for (const run of runs) {
        const bs = blobs((await run.lab.read()).state, N, run.lab.layout.S, 1, 0.2);
        const out = bs.filter((b) => Math.hypot(b.x - c, b.y - c) > run.r + 6);
        run.outside.push(out.length);
        run.inside.push(bs.length - out.length);
        run.area.push(out.reduce((s, b) => s + b.area, 0));
        // an emission: an outside blob near the disk edge with no previous outside blob nearby
        for (const b of out) {
          const d = Math.hypot(b.x - c, b.y - c);
          if (d < run.r + 20 && !run.prev.some((p) => Math.hypot(p.x - b.x, p.y - b.y) < 12)) run.emissions++;
        }
        run.prev = out;
      }
    }
    for (const run of runs) {
      const late = run.outside.slice(run.outside.length >> 1);
      const lateIn = run.inside.slice(run.inside.length >> 1);
      const maxArea = Math.max(...run.area);
      const alive = lateIn.some((v) => v > 0) || late.some((v) => v > 0);
      const kind =
        !alive ? 'dead' :
        maxArea > 0.08 * N * N ? 'flood' :
        late.filter((v) => v > 0).length >= late.length * 0.4 && run.emissions >= 3 ? 'GUN?' :
        run.emissions > 0 ? 'puffs' : 'still';
      const rec = { F: run.F, k: run.k, r: run.r, kind, emissions: run.emissions, lateOutsideMean: late.reduce((a, b) => a + b, 0) / late.length, maxArea, insideEnd: run.inside.at(-1) };
      results.push(rec);
      log(`F=${run.F} k=${run.k} r=${run.r}: ${kind.padEnd(5)} emissions=${run.emissions} lateOut=${rec.lateOutsideMean.toFixed(1)} maxArea=${maxArea} insideEnd=${rec.insideEnd}`);
      run.lab.sim.destroy?.();
    }
  }
  return results;
}
