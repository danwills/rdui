// Spot turnover of Gray-Scott Lineages (uniform traits) at candidate F/k: how much of
// the b pattern changes between snapshots once settled, and how full the field is.
import * as R from '../src/rule';
import { makeLab, runAll, log, saveFrame } from './lab';

export default async function (cfg: { N?: number; cands: [string, number, number][]; warm?: number; every?: number; snaps?: number }) {
  const N = cfg.N ?? 256, warm = cfg.warm ?? 20000, every = cfg.every ?? 2000, snaps = cfg.snaps ?? 6;
  for (const [name, F, k] of cfg.cands) {
    const lab = await makeLab(R.GS_LINEAGES, N, { F, k }, 'initial');
    const { state, params } = await lab.read();
    const S4 = lab.layout.S * 4;
    for (let i = 0; i < N * N; i++) { state[i * S4 + 2] = F; state[i * S4 + 3] = k; }
    lab.sim.load(state, params);
    await runAll([lab], warm);
    let prev: Uint8Array | null = null, turn = 0, fill = 0;
    for (let s = 0; s < snaps; s++) {
      if (s) await runAll([lab], every);
      const st = (await lab.read()).state, m = new Uint8Array(N * N);
      let on = 0;
      for (let c = 0; c < N * N; c++) if (st[c * S4 + 1] > 0.15) { m[c] = 1; on++; }
      if (prev) { let ch = 0; for (let c = 0; c < N * N; c++) ch += m[c] ^ prev[c]; turn += ch / (on + 0.02 * N * N) / (snaps - 1); }
      prev = m; fill = on / (N * N);
    }
    log(`${name} F ${F} k ${k}: fill ${fill.toFixed(3)} turnover ${turn.toFixed(3)} per ${every} steps`);
    await saveFrame(`${name}.png`, lab, { ri: 1, lo: 0, hi: 0.5, scale: 1, caption: `${name} F ${F} k ${k} turnover ${turn.toFixed(2)}` });
    lab.sim.destroy();
  }
}
