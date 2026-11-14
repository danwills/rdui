// Look at a Gray-Scott seed over time at given F, k, D: b range, mean, and frames.
import { GRAY_SCOTT } from '../src/rule';
import { makeLab, saveFrame, log } from './lab';

export default async function (cfg: { F: number; k: number; D?: number; N?: number; steps?: number; every?: number; r?: number; half?: boolean }) {
  const N = cfg.N ?? 192, lab = await makeLab(GRAY_SCOTT, N, { F: cfg.F, k: cfg.k, D: cfg.D ?? 1 });
  const { state } = await lab.read(), c = N / 2, r = cfg.r ?? 8;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x + 0.5 - c, dy = y + 0.5 - c;
    if (dx * dx + dy * dy < r * r && (!cfg.half || dx > 0)) { state[(y * N + x) * 4] = 0.5; state[(y * N + x) * 4 + 1] = 0.25; }
  }
  lab.sim.writeRegion(0, 0, N, N, undefined, state);
  let f = 0;
  for (let t = 0; t <= (cfg.steps ?? 20000); t += cfg.every ?? 2000) {
    if (t) await lab.run(cfg.every ?? 2000);
    const s = (await lab.read()).state;
    let lo = 9, hi = -9, m = 0, alo = 9;
    for (let i = 0; i < N * N; i++) { const b = s[i * 4 + 1]; lo = Math.min(lo, b); hi = Math.max(hi, b); m += b; alo = Math.min(alo, s[i * 4]); }
    log(`t=${t}: b ${lo.toFixed(3)}…${hi.toFixed(3)} mean ${(m / N / N).toFixed(3)}  a min ${alo.toFixed(3)}`);
    await saveFrame(`f${String(f++).padStart(4, '0')}.png`, lab, { ri: 1, lo: 0, hi: 0.4, scale: 1, caption: `F=${cfg.F} k=${cfg.k} t=${t}` });
  }
}
