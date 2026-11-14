// Record Gray-Scott Weather picks: each pick as b and one field side by side (fixed ranges).
import * as R from '../src/rule';
import { makeLab, runAll, saveFrame } from './lab';

export default async function (cfg: { picks: { label: string; set: Record<string, number>; field: string; lo: number; hi: number }[]; N?: number; steps?: number; every?: number }) {
  const N = cfg.N ?? 256, steps = cfg.steps ?? 150000, every = cfg.every ?? 1000;
  const labs = [];
  for (const p of cfg.picks) labs.push(await makeLab(R.WEATHER_GS, N, p.set, 'initial'));
  for (let t = 0, f = 0; t <= steps; t += every, f++) {
    if (t) await runAll(labs, every);
    for (let i = 0; i < labs.length; i++) {
      const p = cfg.picks[i];
      await saveFrame(`p${i}b/f${String(f).padStart(4, '0')}.png`, labs[i], { ri: 1, lo: 0, hi: 0.8, scale: 1, caption: `${p.label} b  t=${t}` });
      await saveFrame(`p${i}u/f${String(f).padStart(4, '0')}.png`, labs[i], { ri: R.WEATHER_GS.reagents.indexOf(p.field), lo: p.lo, hi: p.hi, scale: 1, caption: `${p.label} ${p.field}` });
    }
  }
}
