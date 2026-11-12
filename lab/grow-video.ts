// Record a crystal growing from one seeded spot in the phyllotaxis medium.
import * as R from '../src/rule';
import { makeLab, seedDisk, saveFrame } from './lab';

export default async function (cfg: { mu: number; beta?: number; steps?: number; every?: number; N?: number }) {
  const N = cfg.N ?? 192, c = N / 2;
  const lab = await makeLab(R.PHYLLOTAXIS, N, { mu: cfg.mu, beta: cfg.beta ?? 3 });
  await seedDisk(lab, c, c, 2.5, { a: 2 });
  const every = cfg.every ?? 400, steps = cfg.steps ?? 40000;
  for (let t = 0, f = 0; t <= steps; t += every, f++) {
    if (t) await lab.run(every);
    await saveFrame(`mu${cfg.mu}/f${String(f).padStart(4, '0')}.png`, lab, { ri: 0, lo: -0.6, hi: 2.4, scale: 3, caption: `one seed spot, mu=${cfg.mu}  t=${t}` });
  }
}
