// Check the spectral kernel_ operator against a direct CPU convolution: one
// step of delta_m = (kernel_u - m)/timestep with timestep 1 leaves m = K * u.
// A very wide sigma should give the field mean everywhere.
import type { RuleDef } from '../src/rule';
import { makeLab, log } from './lab';

export default async function (cfg: { N?: number; cases?: { s1: number; b?: number; s2?: number; dx?: number }[] }) {
  const N = cfg.N ?? 64;
  for (const c of cfg.cases ?? [{ s1: 2 }, { s1: 3, b: 0.5, s2: 6 }, { s1: 1e4 }, { s1: 2, dx: 0.5 }]) {
    const rule: RuleDef = {
      name: 'kernel test', description: '', reagents: ['u', 'm'],
      params: [
        { name: 'timestep', value: 1, min: 0, max: 1 }, { name: 'dx', value: c.dx ?? 1, min: 0, max: 2 },
        { name: 'kernel_sigma', value: c.s1, min: 0, max: 1e5 }, { name: 'kernel_b', value: c.b ?? 0, min: 0, max: 2 },
        { name: 'kernel_sigma2', value: c.s2 ?? 1, min: 0, max: 1e5 },
      ],
      paintable: [], formula: `delta_m = kernel_u - m;`, rest: [0, 0], seed: [null, null], seedNoise: [0, 0],
      initial: [], view: { reagent: 'u', low: 0, high: 1 }, laplacian: 'spectral',
    };
    const lab = await makeLab(rule, N, {}, 'rest');
    // a few random-ish bumps
    const S4 = lab.layout.S * 4, u = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) u[i] = Math.sin(i * 12.9898) * 43758.5453 % 1 > 0.97 ? 1 : 0;
    const st = (await lab.read()).state;
    for (let i = 0; i < N * N; i++) st[i * S4] = u[i];
    lab.sim.writeRegion(0, 0, N, N, undefined, st);
    await lab.run(1);
    const m = (await lab.read()).state;
    // CPU: periodic convolution with sampled (unit-mass, renormalised) Gaussians
    const dx = c.dx ?? 1;
    const gauss = (s: number) => {
      const k = new Float64Array(N * N); let sum = 0;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const ddx = Math.min(x, N - x) * dx, ddy = Math.min(y, N - y) * dx;
        sum += k[y * N + x] = Math.exp(-(ddx * ddx + ddy * ddy) / (2 * s * s));
      }
      return k.map((v) => v / sum);
    };
    const K1 = gauss(c.s1), K2 = gauss(c.s2 ?? 1), b = c.b ?? 0;
    let err = 0, mag = 0;
    for (let y = 0; y < N; y += 7) for (let x = 0; x < N; x += 5) {
      let v = 0;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const uu = u[j * N + i]; if (!uu) continue;
        const o = ((y - j + N) % N) * N + ((x - i + N) % N);
        v += uu * (K1[o] - b * K2[o]);
      }
      err = Math.max(err, Math.abs(v - m[(y * N + x) * S4 + 1])); mag = Math.max(mag, Math.abs(v));
    }
    log(`σ1=${c.s1} b=${b} σ2=${c.s2 ?? '-'} dx=${dx}: max |GPU − CPU| ${err.toExponential(2)} (values up to ${mag.toFixed(4)})`);
    lab.sim.destroy();
  }
}
