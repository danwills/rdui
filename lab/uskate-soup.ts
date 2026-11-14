// U-skate world from random starts, as Munafo first saw the skates: several
// fields of noise at F 0.062 and a few k, frames every `every` steps.
import { GRAY_SCOTT } from '../src/rule';
import { makeLab, runAll, saveFrame, type Lab } from './lab';

export default async function (cfg: { ks?: number[]; D?: number; N?: number; steps?: number; every?: number; patch?: number; seed?: number }) {
  const N = cfg.N ?? 256, ks = cfg.ks ?? [0.0607, 0.0609, 0.0611, 0.0613];
  let s = cfg.seed ?? 1;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const labs: Lab[] = [];
  for (const k of ks) {
    const lab = await makeLab(GRAY_SCOTT, N, { F: 0.062, k, D: cfg.D ?? 1 });
    const { state } = await lab.read(), p = (cfg.patch ?? 0.5) * N, c = N / 2;
    // blocky noise in a central patch: 4×4-cell blocks of random a, b
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (Math.abs(x - c) > p / 2 || Math.abs(y - c) > p / 2) continue;
      const bx = x >> 2, by = y >> 2;
      s = (bx * 73856093) ^ (by * 19349663) ^ (cfg.seed ?? 1); rnd(); rnd();
      state[(y * N + x) * 4] = 0.3 + 0.7 * rnd();
      state[(y * N + x) * 4 + 1] = 0.35 * rnd();
    }
    lab.sim.writeRegion(0, 0, N, N, undefined, state);
    labs.push(lab);
  }
  let f = 0;
  for (let t = 0; t <= (cfg.steps ?? 60000); t += cfg.every ?? 5000) {
    if (t) await runAll(labs, cfg.every ?? 5000);
    for (const [i, lab] of labs.entries()) await saveFrame(`k${ks[i]}-f${String(f).padStart(4, '0')}.png`, lab, { ri: 1, lo: 0, hi: 0.4, scale: 1, caption: `k=${ks[i]} t=${t}` });
    f++;
  }
}
