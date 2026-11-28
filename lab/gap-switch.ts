// node lab/run.mjs gap-switch '{"cases":[[false,1,0.5],[true,2,2],[false,2,2],[true,1,0.5]]}'
// Gap-junction step 5: waves that switch the door (gap-door.ts's door: a disc cut off from the ring's ends by dead
// cells). Two waves, both absorbed by b: u1 closes the door (inside the door, sense = 1, it adds b by close·u1², saturating
// towards b 0.4: an empty door lights) and u2 opens it: it charges h, the door's
// capacitor, by open·u2², saturating at 0.5 (h spreads through the door fast and drains at h_decay), and h adds to the door's kill rate. Each case: door start (true = closed), the pulse's
// wave (1 or 2) and its gain. A pulse starts outside each door; does the door end up open or closed?
import * as R from '../src/rule';
import { makeLab, saveFrame, log } from './lab';

const wave = (u: string, v: string) => `delta_${v} = ((${v} + timestep*c2*laplacian_${u})/(1.0 + timestep*(sponge + wall*b)) - ${v})/timestep;
delta_${u} = (${v} + timestep*c2*laplacian_${u})/(1.0 + timestep*(sponge + wall*b));`;
const GS_SWITCH: R.RuleDef = {
  ...R.GRAY_SCOTT,
  name: 'Gray-Scott wave switch (lab)',
  reagents: ['a', 'b', 'u1', 'v1', 'u2', 'v2', 'h'],
  params: [...R.GRAY_SCOTT.params, { name: 'c2', value: 0.3, min: 0, max: 0.45 }, { name: 'wall', value: 3, min: 0, max: 20 },
    { name: 'sponge', value: 0, min: 0, max: 1 }, { name: 'sense', value: 0, min: 0, max: 1 }, { name: 'close', value: 0.5, min: 0, max: 10 }, { name: 'open', value: 2, min: 0, max: 50 },
    { name: 'D_h', value: 0.3, min: 0, max: 0.37 }, { name: 'h_decay', value: 0.01, min: 0, max: 0.1 }],
  paintable: ['F', 'k', 'D', 'sponge', 'sense', 'close', 'open'],
  formula: `delta_a = D * D_a * laplacian_a - a*b*b + F*(1.0 - a);
delta_b = D * D_b * laplacian_b + a*b*b - (F + k + sense*h)*b + sense*min(close*u1*u1, 0.1)*max(0.4 - b, 0.0);
delta_h = sense*(D_h*laplacian_h + min(open*u2*u2, 1.0)*max(0.5 - h, 0.0) - h_decay*h);
${wave('u1', 'v1')}
${wave('u2', 'v2')}`,
  rest: [1, 0, 0, 0, 0, 0, 0],
  seed: [0.5, 0.25, null, null, null, null, null],
  seedNoise: [0, 0.25, 0, 0, 0, 0, 0],
  view: { reagent: 'b', low: 0, high: 0.4 },
};

export default async function (cfg: { seq?: (1 | 2)[]; close?: number; open?: number; gap?: number; cases?: [boolean, 1 | 2, number][]; amp?: number; src?: number; settle?: number; after?: number; jr?: number; buf?: number; dk?: number; wall?: number; g?: Record<string, number> }) {
  const N = 512, Q = 256, ringR = 80, hw = 3, jr = cfg.jr ?? 10, buf = cfg.buf ?? 3, dk = cfg.dk ?? 0.058;
  const cases = cfg.cases ?? [[false, 1, 0.5], [true, 2, 2], [false, 2, 2], [true, 1, 0.5]];
  const l = await makeLab(GS_SWITCH, N, { wall: cfg.wall ?? 3, ...cfg.g }, 'rest');
  const { state, params } = await l.sim.readRegion(0, 0, N, N);
  const S4 = l.layout.S * 4, P4 = l.layout.P * 4, pn = l.layout.paramNames, rg = l.layout.reagents;
  const P = (n: string) => pn.indexOf(n), Rg = (n: string) => rg.indexOf(n);
  const ia = Rg('a'), ib = Rg('b');
  const origin = (q: number) => [(q % 2) * Q + Q / 2, Math.floor(q / 2) * Q + Q / 2];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const q = (y >= Q ? 2 : 0) + (x >= Q ? 1 : 0), [closed, w, gain] = cases[q];
    const dx = (x % Q) - Q / 2 + 0.5, dy = (y % Q) - Q / 2 + 0.5, rr = Math.hypot(dx, dy), jd = Math.hypot(dx - ringR, dy);
    const junc = jd <= jr, band = Math.abs(rr - ringR) <= hw && jd > jr + buf;
    const i = y * N + x;
    params[i * P4 + P('F')] = 0.06;
    params[i * P4 + P('k')] = junc ? dk : band ? 0.057 : 0.075;
    params[i * P4 + P('sense')] = junc ? 1 : 0;
    // (with seq, every door takes both waves, at close / open, and gets the pulses of seq in turn)
    params[i * P4 + P('close')] = cfg.seq ? cfg.close ?? 5 : w === 1 ? gain : 0;
    params[i * P4 + P('open')] = cfg.seq ? cfg.open ?? 1000 : w === 2 ? gain : 0;
    const edge = Math.min(x % Q, Q - 1 - (x % Q), y % Q, Q - 1 - (y % Q));
    params[i * P4 + P('sponge')] = edge < 20 ? 0.3 * ((20 - edge) / 20) ** 2 : 0;
    const fill = junc ? closed : band;
    state[i * S4 + ia] = fill ? 0.4 : 1;
    state[i * S4 + ib] = fill ? 0.3 : 0;
  }
  l.sim.writeRegion(0, 0, N, N, params, state);
  const doorB = (s: Float32Array, q: number) => {
    const [ox, oy] = origin(q);
    let n = 0, sum = 0;
    for (let y = -jr; y <= jr; y++) for (let x = -jr; x <= jr; x++) if (x * x + y * y <= jr * jr) { n++; sum += s[((oy + y) * N + ox + ringR + x) * S4 + ib]; }
    return sum / n;
  };
  const label = ([c, w, g]: [boolean, number, number]) => `${c ? 'closed' : 'open'}+u${w}×${g}`;
  const report = (s: Float32Array) => cases.map((c, q) => `${label(c)}: ${doorB(s, q).toFixed(3)}`).join(' | ');
  await l.run(cfg.settle ?? 10000);
  log(`settled: ${report((await l.read()).state)}`);
  const src = cfg.src ?? 28, amp = cfg.amp ?? 1;
  const pulse = async (wOf: (q: number) => number) => {
    const { state: s, params: p } = await l.sim.readRegion(0, 0, N, N);
    cases.forEach((_, q) => {
      const [ox, oy] = origin(q), cx = ox + ringR + src, iu = Rg(`u${wOf(q)}`);
      for (let y = -12; y <= 12; y++) for (let x = -12; x <= 12; x++) s[((oy + y) * N + cx + x) * S4 + iu] = amp * Math.exp(-(x * x + y * y) / 18);
    });
    l.sim.writeRegion(0, 0, N, N, p, s);
  };
  if (cfg.seq) {
    for (const w of cfg.seq) {
      await pulse(() => w);
      await l.run(cfg.gap ?? 3000);
      log(`after u${w}: ${report((await l.read()).state)}`);
    }
  } else {
    await pulse((q) => cases[q][1]);
    const after = cfg.after ?? 10000;
    let done = 0;
    for (const n of [100, 300, 1000, after]) {
      await l.run(n - done); done = n;
      log(`+${n}: ${report((await l.read()).state)}`);
    }
  }
  await saveFrame('switch.png', l, { ri: ib, lo: 0, hi: 0.4, scale: 1, caption: cfg.seq ? `after u${cfg.seq.join(', u')}` : cases.map(label).join(' | ') });
}
