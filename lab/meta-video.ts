// Record metaGrayScott search picks side by side (sets from meta-search's result.json).
import { loadBundled } from '../src/ready';
import { makeLab, runAll, saveFrame } from './lab';

export default async function (cfg: { picks: { label: string; set: Record<string, number> }[]; N?: number; steps?: number; every?: number }) {
  const N = cfg.N ?? 256, steps = cfg.steps ?? 120000, every = cfg.every ?? 1000;
  const imp = await loadBundled('metaGrayScott_timeworms');
  const labs = [];
  for (const p of cfg.picks) labs.push(await makeLab(imp.rule, N, p.set, 'initial'));
  for (let t = 0, f = 0; t <= steps; t += every, f++) {
    if (t) await runAll(labs, every);
    for (let i = 0; i < labs.length; i++) {
      await saveFrame(`p${i}/f${String(f).padStart(4, '0')}.png`, labs[i], { ri: 1, lo: 0, hi: 0.8, ti: 4, tlo: 0, thi: 0.6, scale: 1, caption: `${cfg.picks[i].label}  t=${t}` });
    }
  }
}
