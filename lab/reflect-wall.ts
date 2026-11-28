// node lab/run.mjs reflect-wall '{"pin":0.5}'
// Reflecting walls for the U cavity: where there's b the wave is pinned (a stiff spring, -pin·b·u) instead of damped
// (-wall·b·v), so a wavefront bounces off a worm wall rather than dying in it. A straight band of worm across the
// field, a pulse of u fired at it from one side: how much energy comes back, how much goes through, how much is lost?
import * as R from '../src/rule';
import { makeLab, saveFrame, log } from './lab';

const RULE: R.RuleDef = {
  ...R.GAP_JUNCTION,
  name: 'reflecting wall test (lab)',
  params: [...R.GAP_JUNCTION.params, { name: 'pin', value: 0, min: 0, max: 50 }],
  formula: R.GAP_JUNCTION.formula
    .replace('delta_v = ((v + timestep*(c2*laplacian_u + emit*sin(omega*clock)))', 'delta_v = ((v + timestep*(c2*laplacian_u - pin*b*u + emit*sin(omega*clock)))')
    .replace('delta_u = (v + timestep*(c2*laplacian_u + emit*sin(omega*clock)))', 'delta_u = (v + timestep*(c2*laplacian_u - pin*b*u + emit*sin(omega*clock)))'),
  initial: [],
};

export default async function (cfg: { pin?: number; wall?: number; hw?: number; steps?: number }) {
  const N = 512, hw = cfg.hw ?? 3, wy = 300;
  const l = await makeLab(RULE, N, { pin: cfg.pin ?? 0, wall: cfg.wall ?? 0 }, 'rest');
  const { state, params } = await l.sim.readRegion(0, 0, N, N);
  const S4 = l.layout.S * 4, P4 = l.layout.P * 4, pn = l.layout.paramNames, rg = l.layout.reagents;
  const P = (n: string) => pn.indexOf(n), ia = rg.indexOf('a'), ib = rg.indexOf('b'), iu = rg.indexOf('u'), iv = rg.indexOf('v');
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, edge = Math.min(x, N - 1 - x, y, N - 1 - y), band = Math.abs(y - wy) <= hw;
    params[i * P4 + P('sponge')] = edge < 30 ? 0.3 * ((30 - edge) / 30) ** 2 : 0;
    params[i * P4 + P('k')] = band ? 0.057 : 0.075;
    state[i * S4 + ia] = band ? 0.4 : 1;
    state[i * S4 + ib] = band ? 0.3 : 0;
  }
  l.sim.writeRegion(0, 0, N, N, params, state);
  await l.run(3000); // let the band settle into a worm
  const { state: s, params: p } = await l.sim.readRegion(0, 0, N, N);
  // a plane-ish pulse travelling down (+y) at the wall: u a Gaussian ridge, v set so it moves one way
  const c = Math.sqrt(0.3), y0 = 200, sg = 6;
  for (let y = 150; y < 250; y++) for (let x = 40; x < N - 40; x++) {
    const g = Math.exp(-((y - y0) ** 2) / (2 * sg * sg)), i = (y * N + x) * S4;
    s[i + iu] = g; s[i + iv] = c * g * (y - y0) / (sg * sg);
  }
  l.sim.writeRegion(0, 0, N, N, p, s);
  const energy = (st: Float32Array, y0: number, y1: number) => {
    let e = 0;
    for (let y = y0; y < y1; y++) for (let x = 60; x < N - 60; x++) { const i = (y * N + x) * S4; e += st[i + iv] ** 2; }
    return e;
  };
  const e0 = energy((await l.read()).state, 40, wy - hw - 2);
  let back = 0, through = 0;
  for (let n = 25; n <= (cfg.steps ?? 250); n += 25) {
    await l.run(25);
    const { state: st } = await l.read();
    back = energy(st, 40, wy - hw - 2) / e0; through = energy(st, wy + hw + 2, N - 40) / e0;
    log(`+${n}: above ${back.toFixed(3)}, below ${through.toFixed(3)}`);
  }
  await saveFrame('reflect.png', l, { ri: iu, lo: -0.3, hi: 0.3, scale: 1, caption: `pin ${cfg.pin ?? 0} wall ${cfg.wall ?? 0}` });
}
