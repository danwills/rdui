// node lab/run.mjs fluid-ops
// Checks flow_x_/flow_y_ against a Gaussian vortex's speed Γ/(2πr), and advect_ against a constant drift.
import type { RuleDef } from '../src/rule';
import { makeLab, log } from './lab';

export default async function () {
  const N = 256, dx = 0.5;
  const V: RuleDef = {
    name: 'flow test', description: '', reagents: ['omega', 'u', 'v'], laplacian: 'spectral',
    params: [{ name: 'timestep', value: 1, min: 0, max: 1 }, { name: 'dx', value: dx, min: 0, max: 1 }], paintable: [],
    formula: 'delta_u = (flow_x_omega - u)/timestep;\ndelta_v = (flow_y_omega - v)/timestep;',
    rest: [0, 0, 0], seed: [null, null, null], seedNoise: [0, 0, 0],
    initial: [{ chem: 'omega', op: 'overwrite', fill: { type: 'bump', value: 1, edge: 3 }, shape: { type: 'circle', cx: 0.5, cy: 0.5, r: 8 / N } }],
    view: { reagent: 'omega', low: 0, high: 1 },
  };
  const l = await makeLab(V, N, {}, 'initial');
  await l.run(1);
  const { state } = await l.read();
  const S4 = l.layout.S * 4, at = (x: number, y: number, k: number) => state[(y * N + x) * S4 + k];
  let gam = 0;
  for (let c = 0; c < N * N; c++) gam += state[c * S4] * dx * dx;
  for (const r of [20, 40, 60]) {
    // r cells above the centre (row decreases = up), and to the right
    const up = [at(128, 128 - r, 1), at(128, 128 - r, 2)], right = [at(128 + r, 128, 1), at(128 + r, 128, 2)];
    log(`r ${r} cells: above (u,v) ${up.map((q) => q.toFixed(4))} · right ${right.map((q) => q.toFixed(4))} · Γ/2πr ${(gam / (2 * Math.PI * r * dx)).toFixed(4)}`);
  }
  const A: RuleDef = {
    ...V, name: 'advect test', reagents: ['dye'],
    params: [...V.params, { name: 'vx', value: 2, min: -9, max: 9 }, { name: 'vy', value: 1, min: -9, max: 9 }],
    formula: 'delta_dye = (advect_dye(vx, vy) - dye)/timestep;', rest: [0], seed: [null], seedNoise: [0],
    initial: [{ chem: 'dye', op: 'overwrite', fill: { type: 'bump', value: 1, edge: 2 }, shape: { type: 'circle', cx: 0.5, cy: 0.5, r: 6 / N } }],
    view: { reagent: 'dye', low: 0, high: 1 },
  };
  const a = await makeLab(A, N, { timestep: 0.1 }, 'initial');
  const cen = async () => { const s = (await a.read()).state; let m = 0, sx = 0, sy = 0; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const q = s[(y * N + x) * 4]; m += q; sx += q * x; sy += q * y; } return [sx / m, sy / m, m]; };
  const c0 = await cen();
  await a.run(100);
  const c1 = await cen();
  log(`advect 100 steps of 0.1 at (2, 1) (dx 0.5): moved ${(c1[0] - c0[0]).toFixed(2)} cells right, ${(c0[1] - c1[1]).toFixed(2)} up (expect 40, 20); mass ${c0[2].toFixed(1)} → ${c1[2].toFixed(1)}`);
}
