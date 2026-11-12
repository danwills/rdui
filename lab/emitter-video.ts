// Record a single soliton growing into a glider-shedding cluster.
import { GS_HISTORY_WAVE } from '../src/rule';
import { makeLab, saveFrame, STARTERS } from './lab';

export default async function (cfg: { F: number; k: number; steps?: number; every?: number; N?: number; tag?: string }) {
  const N = cfg.N ?? 384, g = { F: cfg.F, k: cfg.k };
  const lab = await makeLab(GS_HISTORY_WAVE, N, g);
  await lab.place(STARTERS('starter-soliton-hw65'), N / 2, N / 2);
  const every = cfg.every ?? 1000, steps = cfg.steps ?? 90000;
  for (let t = 0, f = 0; t <= steps; t += every, f++) {
    if (t) await lab.run(every);
    await saveFrame(`${cfg.tag ?? `F${cfg.F}-k${cfg.k}`}/f${String(f).padStart(4, '0')}.png`, lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.4, scale: 1, caption: `one soliton, F=${cfg.F} k=${cfg.k}  t=${t}` });
  }
}
