// Spectral vs stencil operators on sine waves (exact answers known), then
// throughput of History+Wave in both modes.
import * as R from '../src/rule';
import { makeLab, runAll, log } from './lab';

const PROBE: R.RuleDef = {
  name: 'operator probe', description: '', reagents: ['a', 'b', 'c'],
  params: [{ name: 'timestep', value: 1, min: 0, max: 1 }],
  paintable: [], rest: [0, 0, 0], seed: [null, null, null], seedNoise: [0, 0, 0], initial: [],
  formula: 'delta_a = 0.0;\ndelta_b = laplacian_a - b;\ndelta_c = bilaplacian_a - c;',
} as unknown as R.RuleDef;

export default async function () {
  const N = 256;
  for (const mode of ['stencil', 'spectral-exact'] as const) {
    const rows: string[] = [];
    for (const [mx, my] of [[1, 0], [8, 0], [8, 8], [32, 0], [24, 24], [64, 0], [48, 48]]) {
      const l = await makeLab({ ...PROBE, laplacian: mode }, N, {});
      const f = await l.read(), S4 = l.layout.S * 4;
      const k2 = ((2 * Math.PI) / N) ** 2 * (mx * mx + my * my);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) f.state[(y * N + x) * S4] = Math.sin((2 * Math.PI * (mx * x + my * y)) / N);
      l.sim.load(f.state, f.params);
      await l.run(1);
      const o = (await l.read()).state;
      let eL = 0, eB = 0, nL = 0, nB = 0;
      for (let i = 0; i < N * N; i++) {
        const a = f.state[i * S4];
        eL = Math.max(eL, Math.abs(o[i * S4 + 1] + k2 * a)); nL = Math.max(nL, Math.abs(k2 * a));
        eB = Math.max(eB, Math.abs(o[i * S4 + 2] - k2 * k2 * a)); nB = Math.max(nB, Math.abs(k2 * k2 * a));
      }
      rows.push(`(${mx},${my}) λ=${(N / Math.hypot(mx, my)).toFixed(1)}px: lap err ${((100 * eL) / nL).toFixed(3)}%  bilap err ${((100 * eB) / nB).toFixed(3)}%`);
      l.sim.destroy();
    }
    log(`${mode}:\n  ${rows.join('\n  ')}`);
  }
  for (const mode of ['stencil', 'spectral'] as const) {
    const l = await makeLab({ ...R.GS_HISTORY_WAVE, laplacian: mode }, N, { F: 0.052, k: 0.066, c_damp: 0.0009 });
    await l.run(200);
    const t0 = performance.now();
    await runAll([l], 3000);
    log(`History+Wave ${N}², ${mode}: ${(3000 / ((performance.now() - t0) / 1000)).toFixed(0)} steps/s`);
    l.sim.destroy();
  }
}
