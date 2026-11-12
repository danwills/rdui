// Subcritical localized states: does a single seeded spot persist in a flat
// field (and do neighbouring spots grow out of it)?
import * as R from '../src/rule';
import { makeLab, runAll, blobs, seedDisk, saveFrame, log, type Lab } from './lab';

export default async function (cfg: { builtin?: number; mus?: number[]; betas?: number[]; amp?: number; r?: number; steps?: number }) {
  const N = 128, c = 64, rule = R.BUILTIN_RULES[cfg.builtin ?? 4];
  const jobs = (cfg.betas ?? [3]).flatMap((beta) => (cfg.mus ?? [-0.02, -0.05, -0.1, -0.2, -0.3, -0.5]).map((mu) => ({ mu, beta })));
  const runs: { g: Record<string, number>; lab: Lab; hist: string[] }[] = [];
  for (const g of jobs) {
    const l = await makeLab(rule, N, g);
    await seedDisk(l, c, c, cfg.r ?? 2.5, { a: cfg.amp ?? 2 });
    runs.push({ g, lab: l, hist: [] });
  }
  const steps = cfg.steps ?? 30000;
  for (let t = 0; t < steps; t += steps / 6) {
    await runAll(runs.map((r) => r.lab), steps / 6);
    for (const r of runs) {
      const bs = blobs((await r.lab.read()).state, N, 1, 0, 0.5, 1);
      r.hist.push(`${bs.length}${bs.length ? `(pk ${Math.max(...bs.map((b) => b.peak)).toFixed(2)})` : ''}`);
    }
  }
  for (const r of runs) {
    log(`mu=${r.g.mu} beta=${r.g.beta}: spots every ${steps / 6}: ${r.hist.join(' ')}`);
    await saveFrame(`mu${r.g.mu}-b${r.g.beta}.png`, r.lab, { ri: 0, lo: -0.6, hi: 2, scale: 2, caption: `mu=${r.g.mu} beta=${r.g.beta}` });
  }
}
