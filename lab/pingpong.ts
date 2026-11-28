// node lab/run.mjs pingpong '{"buf":0,"sep":300,"emit":0.5,"dk":0.05,"g":{"lit":0,"g_refill":0.004,"h_self":4}}'
// NOT WORKING YET: it switches once or twice, then both doors lock open (each bathed by the other's steady stream,
// the capacitor and fuel settle into a steady pattern across the door). See the gap-junction memory for what was tried.
// Gap-junction step 6: a wave ping-pong. Two rings (gap-switch.ts's walls and doors), each with an emitter at its
// centre radiating all the time: A's u1, B's u2. A's door is lit (closed) by u1 and its capacitor charged (opened) by
// u2; B's the other way round. So when A's door opens, a burst of u1 gets out before A's own waves shut it again; the
// burst opens B's door, B's burst of u2 gets out (and B shuts itself), and it opens A's door, and so on. How long a
// door stays open is how long its capacitor takes to drain. Its capacitor charges from a fuel that an opening spends
// and that refills slowly, so a door just opened can't be held open by the other's waves (they'd hold each other open).
import * as R from '../src/rule';
import { makeLab, saveFrame, log } from './lab';

const wave = (u: string, v: string, e: string) => `delta_${v} = ((${v} + timestep*(c2*laplacian_${u} + ${e}*sin(omega*clock)))/(1.0 + timestep*(sponge + wall*b)) - ${v})/timestep;
delta_${u} = (${v} + timestep*(c2*laplacian_${u} + ${e}*sin(omega*clock)))/(1.0 + timestep*(sponge + wall*b));`;
export const GS_PINGPONG: R.RuleDef = {
  ...R.GRAY_SCOTT,
  name: 'Gray-Scott wave ping-pong (lab)',
  reagents: ['a', 'b', 'u1', 'v1', 'u2', 'v2', 'h', 'g', 'clock'],
  params: [...R.GRAY_SCOTT.params, { name: 'c2', value: 0.3, min: 0, max: 0.45 }, { name: 'wall', value: 3, min: 0, max: 20 },
    { name: 'sponge', value: 0, min: 0, max: 1 }, { name: 'door', value: 0, min: 0, max: 2 },
    { name: 'lit', value: 5, min: 0, max: 10 }, { name: 'kill', value: 0.3, min: 0, max: 1 }, { name: 'kill_th', value: 2e-5, min: 0, max: 1e-3 },
    { name: 'D_h', value: 0.15, min: 0, max: 0.2 }, { name: 'h_decay', value: 0, min: 0, max: 0.1 }, { name: 'h_self', value: 1, min: 0, max: 5 }, { name: 'h_kill', value: 0.3, min: 0, max: 0.5 }, { name: 'g_refill', value: 0.007, min: 0, max: 0.1 }, { name: 'spend', value: 0.05, min: 0, max: 1 },
    { name: 'emit', value: 0, min: -1, max: 1 }, { name: 'omega', value: 0.2094, min: 0, max: 1 }],
  // door 1: A's kind (lit by u1, opened by u2); door 2: B's kind (the other way round). emit > 0 radiates u1, < 0 u2
  paintable: ['k', 'sponge', 'door', 'emit'],
  formula: `float dA = max(1.0 - abs(door - 1.0), 0.0);
float dB = max(1.0 - abs(door - 2.0), 0.0);
float sense = dA + dB;
float emit1 = max(emit, 0.0);
float emit2 = max(-emit, 0.0);
delta_a = D * D_a * laplacian_a - a*b*b + F*(1.0 - a);
delta_b = D * D_b * laplacian_b + a*b*b - (F + k + sense*h)*b + sense*min(lit*(dA*u1*u1 + dB*u2*u2), 0.1)*max(0.4 - b, 0.0);
// the capacitor h is excitable (FitzHugh–Nagumo-like): bistable by itself (0 or 0.5, h_self), kicked up by a wave
// above kill_th; a charged capacitor (an open door) burns the slow fuel g, and without fuel h is killed (h_kill): so
// an opening is a clean pulse, and a door just opened can't be opened again until its fuel refills
// (all or nothing: a wave above kill_th charges it fast; the trickle through closed walls doesn't)
float E = dA*u2*u2 + dB*u1*u1;
float charge = kill*smoothstep(kill_th, 2.0*kill_th, E)*smoothstep(0.85, 0.95, g)*max(0.5 - h, 0.0);
delta_h = sense*(D_h*laplacian_h + charge + h_self*h*(h - 0.1)*(0.5 - h) - h_kill*(1.0 - g)*h - h_decay*h);
delta_g = sense*(D_h*laplacian_g - spend*smoothstep(0.2, 0.3, h)*g + g_refill*(1.0 - g));
${wave('u1', 'v1', 'emit1')}
${wave('u2', 'v2', 'emit2')}
delta_clock = 1.0;`,
  rest: [1, 0, 0, 0, 0, 0, 0, 1, 0],
  seed: [0.5, 0.25, null, null, null, null, null, null, null],
  seedNoise: [0, 0.25, 0, 0, 0, 0, 0, 0, 0],
  view: { reagent: 'b', low: 0, high: 0.4 },
};

export default async function (cfg: { verbose?: boolean; emit?: number; buf?: number; dk?: number; jr?: number; steps?: number; every?: number; ringR?: number; sep?: number; g?: Record<string, number>; aOpen?: boolean }) {
  const N = 512, ringR = cfg.ringR ?? 60, hw = 3, jr = cfg.jr ?? 10, buf = cfg.buf ?? 3, sep = cfg.sep ?? 200;
  const l = await makeLab(GS_PINGPONG, N, { ...cfg.g }, 'rest');
  const { state, params } = await l.sim.readRegion(0, 0, N, N);
  const S4 = l.layout.S * 4, P4 = l.layout.P * 4, pn = l.layout.paramNames, rg = l.layout.reagents;
  const P = (n: string) => pn.indexOf(n), ia = rg.indexOf('a'), ib = rg.indexOf('b');
  // ring A on the left with its door facing right, B on the right with its door facing left
  const rings = [{ cx: N / 2 - sep / 2, dir: 1, own: 1 }, { cx: N / 2 + sep / 2, dir: -1, own: 2 }], cy = N / 2;
  const aOpen = cfg.aOpen ?? true;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    params[i * P4 + P('k')] = 0.075;
    const edge = Math.min(x, N - 1 - x, y, N - 1 - y);
    params[i * P4 + P('sponge')] = edge < 30 ? 0.3 * ((30 - edge) / 30) ** 2 : 0;
    let fill = false;
    rings.forEach(({ cx, dir, own }, r) => {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, jd = Math.hypot(dx - dir * ringR, dy);
      const junc = jd <= jr, band = Math.abs(Math.hypot(dx, dy) - ringR) <= hw && jd > jr + buf && !junc;
      if (band) { params[i * P4 + P('k')] = 0.057; fill = true; }
      if (junc) {
        params[i * P4 + P('k')] = cfg.dk ?? 0.058;
        params[i * P4 + P('door')] = own;
        fill = r === 0 ? !aOpen : aOpen;
      }
      if (Math.hypot(dx, dy) <= 4) params[i * P4 + P('emit')] = (own === 1 ? 1 : -1) * (cfg.emit ?? 0.05);
    });
    state[i * S4 + ia] = fill ? 0.4 : 1;
    state[i * S4 + ib] = fill ? 0.3 : 0;
    if (params[i * P4 + P('door')] === (aOpen ? 1 : 2)) { state[i * S4 + rg.indexOf('h')] = 0.5; state[i * S4 + rg.indexOf('g')] = 0; }
  }
  l.sim.writeRegion(0, 0, N, N, params, state);
  const doorMean = (s: Float32Array, r: number, ri: number) => {
    const { cx, dir } = rings[r], dxc = Math.round(cx + dir * ringR);
    let n = 0, sum = 0;
    for (let y = -jr; y <= jr; y++) for (let x = -jr; x <= jr; x++) if (x * x + y * y <= jr * jr) { n++; sum += s[((cy + y) * N + dxc + x) * S4 + ri]; }
    return sum / n;
  };
  const doorB = (s: Float32Array, r: number) => doorMean(s, r, ib);
  const ih = rg.indexOf('h'), ig = rg.indexOf('g');
  const sq = (s: Float32Array, r: number, ri: number) => {
    const { cx, dir } = rings[r], dxc = Math.round(cx + dir * ringR);
    let n = 0, sum = 0;
    for (let y = -jr; y <= jr; y++) for (let x = -jr; x <= jr; x++) if (x * x + y * y <= jr * jr) { n++; sum += s[((cy + y) * N + dxc + x) * S4 + ri] ** 2; }
    return sum / n;
  };
  // at each door: h, g and the mean square of the wave that opens it (A: u2, B: u1)
  const hg = (s: Float32Array) => [0, 1].map((r) => `h ${doorMean(s, r, ih).toFixed(2)} g ${doorMean(s, r, ig).toFixed(2)} E ${sq(s, r, rg.indexOf(r ? 'u1' : 'u2')).toExponential(1)}`).join(' / ');
  const steps = cfg.steps ?? 20000, every = cfg.every ?? 100;
  let last = '', trace = '';
  for (let n = every; n <= steps; n += every) {
    await l.run(every);
    const { state: s } = await l.read();
    const a = doorB(s, 0), b = doorB(s, 1), st = `${a > 0.15 ? 'A shut' : 'A open'} ${b > 0.15 ? 'B shut' : 'B open'}`;
    if (st !== last || cfg.verbose) { log(`step ${n}: ${st} (door b ${a.toFixed(2)} / ${b.toFixed(2)}; ${hg(s)})`); last = st; }
    if (n % 1000 === 0) trace += `${n}:${a.toFixed(2)}/${b.toFixed(2)} `;
    if (n === 300 || n === 2000) await saveFrame(`pp-u1-${n}.png`, l, { ri: rg.indexOf('u1'), lo: -0.3, hi: 0.3, scale: 1, caption: `u1 at ${n}` });
  }
  log(trace);
  await saveFrame('pp-b.png', l, { ri: ib, lo: 0, hi: 0.4, scale: 1, caption: `b at ${steps}` });
}
