// Gray-Scott Lineages: do spots keep their inherited F/k when they spread into
// a region painted with other values? Left half painted A, right half B; spots
// seeded only on the left (or both sides: cfg.both). Logs the b-weighted mean
// trait in each half over time, and saves b tinted by P_F.
import * as R from '../src/rule';
import { makeLab, runAll, saveFrame, seedDisk, log } from './lab';

export default async function (cfg: { N?: number; steps?: number; every?: number; A?: [number, number]; B?: [number, number]; both?: boolean; tag?: string }) {
  const N = cfg.N ?? 256, steps = cfg.steps ?? 30000, every = cfg.every ?? 3000, tag = cfg.tag ?? 'run';
  const A = cfg.A ?? [0.0367, 0.0649], B = cfg.B ?? [0.03, 0.062];
  const lab = await makeLab(R.GS_LINEAGES, N, { F: A[0], k: A[1] }, 'rest');
  await lab.paint(N / 2, 0, N / 2, N, { F: B[0], k: B[1] });
  // traits start at each side's painted values
  {
    const { state, params } = await lab.read();
    const S4 = lab.layout.S * 4;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = (y * N + x) * S4, right = x >= N / 2;
      state[i + 2] = right ? B[0] : A[0];
      state[i + 3] = right ? B[1] : A[1];
    }
    lab.sim.load(state, params);
  }
  for (let n = 0; n < 6; n++) await seedDisk(lab, N * (0.1 + 0.25 * Math.random()), N * (0.1 + 0.8 * Math.random()), 5, { a: 0.5, b: 0.25 });
  if (cfg.both) for (let n = 0; n < 6; n++) await seedDisk(lab, N * (0.65 + 0.25 * Math.random()), N * (0.1 + 0.8 * Math.random()), 5, { a: 0.5, b: 0.25 });
  const S4 = lab.layout.S * 4;
  for (let t = 0; t <= steps; t += every) {
    if (t) await runAll([lab], every);
    const { state } = await lab.read();
    const half = [0, 1].map((h) => {
      let wb = 0, wf = 0, wk = 0, nan = 0;
      for (let y = 0; y < N; y++) for (let x = h * N / 2; x < (h + 1) * N / 2; x++) {
        const i = (y * N + x) * S4, b = state[i + 1];
        if (!Number.isFinite(b + state[i + 2])) { nan++; continue; }
        if (b > 0.1) { wb += b; wf += b * state[i + 2]; wk += b * state[i + 3]; }
      }
      return `${h ? 'right' : 'left'}: b-mass ${wb.toFixed(0)} trait F ${wb ? (wf / wb).toFixed(4) : '-'} k ${wb ? (wk / wb).toFixed(4) : '-'}${nan ? ` NaN ${nan}` : ''}`;
    });
    log(t, half.join('  |  '));
    await saveFrame(`${tag}-${String(t).padStart(6, '0')}.png`, lab, { ri: 1, lo: 0, hi: 0.4, ti: 2, tlo: Math.min(A[0], B[0]) - 0.002, thi: Math.max(A[0], B[0]) + 0.002, scale: 1, caption: `t=${t}  tint = P_F (A ${A[0]}, B ${B[0]})` });
  }
}
