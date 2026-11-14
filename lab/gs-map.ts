// The Gray-Scott parameter map (after Pearson and Munafo's xmorphia map): one
// field where every cell has its own F (rising upward) and k (rising rightward),
// over the F/k pad's ranges, seeded with spots everywhere and run long; walled
// at the border so opposite edges don't mix. Saves frames of b; the last is the
// app's map image (src/assets/gs-map.webp, made from it).
import { GRAY_SCOTT } from '../src/rule';
import { makeLab, runAll, saveFrame, log } from './lab';

export default async function (cfg: { N?: number; F?: [number, number]; k?: [number, number]; steps?: number; every?: number; spots?: number }) {
  const N = cfg.N ?? 1024, [F0, F1] = cfg.F ?? [0, 0.1], [k0, k1] = cfg.k ?? [0.03, 0.075];
  const lab = await makeLab(GRAY_SCOTT, N, {});
  const { state, params } = await lab.read();
  const S4 = lab.layout.S * 4, P4 = lab.layout.P * 4, names = lab.layout.paramNames;
  const iF = names.indexOf('F'), ik = names.indexOf('k'), iD = names.indexOf('D');
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    params[i * P4] = x === 0 || y === 0 || x === N - 1 || y === N - 1 ? 1 : 0;
    params[i * P4 + iF] = F1 - ((y + 0.5) / N) * (F1 - F0);
    params[i * P4 + ik] = k0 + ((x + 0.5) / N) * (k1 - k0);
    if (iD > 0) params[i * P4 + iD] = 1;
    state[i * S4] = 1;
    state[i * S4 + 1] = 0;
  }
  // deterministic spots everywhere
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let n = 0; n < (cfg.spots ?? (N * N) / 900); n++) {
    const cx = rnd() * N, cy = rnd() * N, r = 3 + rnd() * 5;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (x < 1 || y < 1 || x >= N - 1 || y >= N - 1 || (x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      state[(y * N + x) * S4] = 0.5;
      state[(y * N + x) * S4 + 1] = 0.25;
    }
  }
  lab.sim.writeRegion(0, 0, N, N, params, state);
  const steps = cfg.steps ?? 40000, every = cfg.every ?? 10000;
  let f = 0;
  for (let t = 0; t <= steps; t += every) {
    if (t) await runAll([lab], every);
    await saveFrame(`map-f${String(f++).padStart(4, '0')}.png`, lab, { ri: 1, lo: 0, hi: 0.4, scale: 1 });
    log(`t=${t}`);
  }
  lab.sim.destroy();
}
