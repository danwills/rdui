// node lab/run.mjs gap-door '{"wall":3}'
// Gap-junction step 4: is the junction a door for waves? Gray-Scott (the ring worm and junction of gap-ring.ts) plus a
// wave u, v (symplectic, speed sqrt(c2), the damping implicit so a strong wall can't blow it up) that b absorbs (damping wall·b), so the worm is a wall. A pulse starts outside,
// beside the junction; how much wave energy gets inside the ring? Quadrants: no ring, closed (kink), open (the gap
// state: a b disc r 14 dropped on the settled kink), on (the loop). Sponges at the quadrant edges keep them apart.
import * as R from '../src/rule';
import { makeLab, saveFrame, log } from './lab';

const GS_WAVE: R.RuleDef = {
  ...R.GRAY_SCOTT,
  name: 'Gray-Scott wave door (lab)',
  reagents: ['a', 'b', 'u', 'v'],
  params: [...R.GRAY_SCOTT.params, { name: 'c2', value: 0.3, min: 0, max: 0.45 }, { name: 'wall', value: 3, min: 0, max: 20 }, { name: 'sponge', value: 0, min: 0, max: 1 }],
  paintable: ['F', 'k', 'D', 'sponge'],
  formula: `${R.GRAY_SCOTT.formula}
delta_v = ((v + timestep*c2*laplacian_u)/(1.0 + timestep*(sponge + wall*b)) - v)/timestep;
delta_u = (v + timestep*c2*laplacian_u)/(1.0 + timestep*(sponge + wall*b));`,
  rest: [1, 0, 0, 0],
  seed: [0.5, 0.25, null, null],
  seedNoise: [0, 0.25, 0, 0],
  view: { reagent: 'b', low: 0, high: 0.4 },
};

export default async function (cfg: { door?: boolean; buf?: number; dk?: number; wall?: number; c2?: number; settle?: number; waveSteps?: number; jr?: number; R?: number; hw?: number; src?: number }) {
  const N = 512, Q = 256, ringR = cfg.R ?? 80, jr = cfg.jr ?? 14, hw = cfg.hw ?? 3;
  const l = await makeLab(GS_WAVE, N, { wall: cfg.wall ?? 3, c2: cfg.c2 ?? 0.3 }, 'rest');
  const { state, params } = await l.sim.readRegion(0, 0, N, N);
  const S4 = l.layout.S * 4, P4 = l.layout.P * 4, pn = l.layout.paramNames, rg = l.layout.reagents;
  const iF = pn.indexOf('F'), ik = pn.indexOf('k'), isp = pn.indexOf('sponge');
  const ia = rg.indexOf('a'), ib = rg.indexOf('b'), iu = rg.indexOf('u'), iv = rg.indexOf('v');
  // door: the junction is a disc (k dk) cut off from the ring's ends by buf dead cells, so the ring can't light it;
  // filled it closes the door, empty it leaves a hole. Quadrants: no ring, solid ring, door closed, door open
  const door = cfg.door ?? false, buf = cfg.buf ?? 3, dk = cfg.dk ?? 0.058;
  const names = door ? ['no ring', 'solid ring', 'door closed', 'door open'] : ['no ring', 'closed (kink)', 'open (gap)', 'on (loop)'];
  const origin = (q: number) => [(q % 2) * Q + Q / 2, Math.floor(q / 2) * Q + Q / 2];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const q = (y >= Q ? 2 : 0) + (x >= Q ? 1 : 0);
    const dx = (x % Q) - Q / 2 + 0.5, dy = (y % Q) - Q / 2 + 0.5, rr = Math.hypot(dx, dy);
    const jd = Math.hypot(dx - ringR, dy), hasDoor = door ? q >= 2 : q > 0;
    const junc = hasDoor && jd <= jr, cut = door && hasDoor && jd <= jr + buf;
    const band = q > 0 && Math.abs(rr - ringR) <= hw && !cut;
    const i = y * N + x;
    params[i * P4 + iF] = 0.06;
    params[i * P4 + ik] = junc ? (door ? dk : 0.0635) : band ? 0.057 : 0.075;
    // a sponge ramping up over the last 20 cells to each quadrant's edge
    const edge = Math.min(x % Q, Q - 1 - (x % Q), y % Q, Q - 1 - (y % Q));
    params[i * P4 + isp] = edge < 20 ? 0.3 * ((20 - edge) / 20) ** 2 : 0;
    const fill = junc ? (door ? q === 2 : q === 3) : band;
    state[i * S4 + ia] = fill ? 0.4 : 1;
    state[i * S4 + ib] = fill ? 0.3 : 0;
  }
  l.sim.writeRegion(0, 0, N, N, params, state);
  const settle = cfg.settle ?? 10000;
  await l.run(settle);
  // the open door: a b disc of radius 14 on quadrant 2's settled kink
  let { state: s, params: p } = await l.sim.readRegion(0, 0, N, N);
  if (!door) {
    const [ox, oy] = origin(2);
    for (let y = -jr; y <= jr; y++) for (let x = -jr; x <= jr; x++) if (Math.hypot(x + 0.5, y + 0.5) <= jr) {
      const i = ((oy + y) * N + ox + ringR + x) * S4;
      s[i + ia] = 0.4; s[i + ib] = 0.3;
    }
  }
  l.sim.writeRegion(0, 0, N, N, p, s);
  await l.run(settle);
  await saveFrame('door-b.png', l, { ri: ib, lo: 0, hi: 0.4, scale: 1, caption: names.join(' | ') });
  // the pulse: a bump of u outside each ring, src cells beyond the junction
  ({ state: s, params: p } = await l.sim.readRegion(0, 0, N, N));
  const src = cfg.src ?? 28;
  for (let q = 0; q < 4; q++) {
    const [ox, oy] = origin(q), cx = ox + ringR + src;
    for (let y = -12; y <= 12; y++) for (let x = -12; x <= 12; x++) {
      const i = ((oy + y) * N + cx + x) * S4;
      s[i + iu] = Math.exp(-(x * x + y * y) / (2 * 3 * 3));
      s[i + iv] = 0;
    }
  }
  l.sim.writeRegion(0, 0, N, N, p, s);
  // energy (v² + c2|∇u|² ~ v² + c2·u²/σ², here just v² + u²·c2/9) inside radius ringR - hw - 3, summed over the run
  const inner = ringR - hw - 3, total = cfg.waveSteps ?? 1200, every = 50;
  const sumIn = [0, 0, 0, 0], peak = [0, 0, 0, 0];
  for (let n = every; n <= total; n += every) {
    await l.run(every);
    const { state: w } = await l.read();
    const line: string[] = [];
    for (let q = 0; q < 4; q++) {
      const [ox, oy] = origin(q);
      let e = 0;
      for (let y = -inner; y <= inner; y++) for (let x = -inner; x <= inner; x++) if (x * x + y * y <= inner * inner) {
        const i = ((oy + y) * N + ox + x) * S4;
        e += w[i + iv] ** 2 + (w[i + iu] ** 2 * (cfg.c2 ?? 0.3)) / 9;
      }
      sumIn[q] += e; peak[q] = Math.max(peak[q], e);
      line.push(e.toExponential(2));
    }
    if (n % 200 === 0) log(`+${n}: energy inside ${line.join(' | ')}`);
    if (n === 200 || n === 400) await saveFrame(`door-u-${n}.png`, l, { ri: iu, lo: -0.05, hi: 0.05, scale: 1, caption: `u at +${n}: ` + names.join(' | ') });
  }
  log(`total inside, relative to no ring: ${names.map((nm, q) => `${nm} ${(sumIn[q] / sumIn[0]).toFixed(3)}`).join(' | ')}`);
}
