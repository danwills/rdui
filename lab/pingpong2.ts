// node lab/run.mjs pingpong2 '{"steps":16000,"closeAt":10000,"damp":0.002,"g":{"wall":10,"D_h":0,"h_kill":0.5,"trig_th":0.002,"spend":0.03,"g_refill":0.0027}}'
// (those settings: a clean ping-pong, a fire every ~555 steps, for ~35000 steps before trapped echoes make it chatter;
// closing A's door stops it. Add "video":20 for frames in lab/out/pingpong2/video/.)
// Gap-junction step 7: a wave ping-pong with burst emitters. Each ring (gap-door.ts's wall and latch door: a disc cut
// off from the ring's ends, so filled and empty both hold) has a small trigger at its centre, an excitable cell (h,
// bistable by itself, with a slow fuel g for refractoriness) that fires once when the other ring's wave arrives above
// trig_th: A's is fired by u2 and while firing radiates u1, B's the other way round. So A's burst goes out through A's
// door, fires B, B's burst comes back in and fires A, and so on, as long as both doors are open. closeAt: fill A's
// door then (it should stop the ping-pong).
import * as R from '../src/rule';
import { makeLab, saveFrame, log } from './lab';

const wave = (u: string, v: string, e: string) => `delta_${v} = ((${v} + timestep*(c2*laplacian_${u} + ${e}))/(1.0 + timestep*(sponge + wall*b)) - ${v})/timestep;
delta_${u} = (${v} + timestep*(c2*laplacian_${u} + ${e}))/(1.0 + timestep*(sponge + wall*b));`;
const GS_PINGPONG2: R.RuleDef = {
  ...R.GRAY_SCOTT,
  name: 'Gray-Scott wave ping-pong 2 (lab)',
  reagents: ['a', 'b', 'u1', 'v1', 'u2', 'v2', 'h', 'g', 'clock'],
  params: [...R.GRAY_SCOTT.params, { name: 'c2', value: 0.3, min: 0, max: 0.45 }, { name: 'wall', value: 3, min: 0, max: 20 },
    { name: 'sponge', value: 0, min: 0, max: 1 }, { name: 'trig', value: 0, min: 0, max: 2 },
    { name: 'trig_th', value: 1e-5, min: 0, max: 1e-3 }, { name: 'fire', value: 0.3, min: 0, max: 1 },
    { name: 'h_self', value: 2, min: 0, max: 5 }, { name: 'h_kill', value: 0.3, min: 0, max: 0.5 },
    { name: 'spend', value: 0.01, min: 0, max: 1 }, { name: 'g_refill', value: 0.004, min: 0, max: 0.1 },
    { name: 'D_h', value: 0.1, min: 0, max: 0.2 }, { name: 'emit', value: 0.5, min: 0, max: 2 }, { name: 'omega', value: 0.2094, min: 0, max: 1 }],
  // trig 1: A's trigger (fired by u2, radiates u1); 2: B's (fired by u1, radiates u2)
  paintable: ['k', 'sponge', 'trig'],
  formula: `float tA = max(1.0 - abs(trig - 1.0), 0.0);
float tB = max(1.0 - abs(trig - 2.0), 0.0);
float sense = tA + tB;
// the trigger: h bistable by itself (0 or 0.5), kicked up by the other wave above trig_th while its fuel g is nearly
// full; firing burns the fuel, and without fuel h dies: one burst, then deaf until the fuel refills
float E = tA*u2*u2 + tB*u1*u1;
float kick = fire*smoothstep(trig_th, 2.0*trig_th, E)*smoothstep(0.85, 0.95, g)*max(0.5 - h, 0.0);
delta_h = sense*(D_h*laplacian_h + kick + h_self*h*(h - 0.1)*(0.5 - h) - h_kill*(1.0 - g)*h);
delta_g = sense*(D_h*laplacian_g - spend*smoothstep(0.2, 0.3, h)*g + g_refill*(1.0 - g));
float burst = 2.0*emit*max(h, 0.0)*sin(omega*clock);
delta_a = D * D_a * laplacian_a - a*b*b + F*(1.0 - a);
delta_b = D * D_b * laplacian_b + a*b*b - (F + k)*b;
${wave('u1', 'v1', 'tA*burst')}
${wave('u2', 'v2', 'tB*burst')}
delta_clock = 1.0;`,
  rest: [1, 0, 0, 0, 0, 0, 0, 1, 0],
  seed: [0.5, 0.25, null, null, null, null, null, null, null],
  seedNoise: [0, 0.25, 0, 0, 0, 0, 0, 0, 0],
  view: { reagent: 'b', low: 0, high: 0.4 },
};

export default async function (cfg: { video?: number; damp?: number; steps?: number; every?: number; sep?: number; ringR?: number; tr?: number; closeAt?: number; rings?: boolean; g?: Record<string, number> }) {
  const N = 512, ringR = cfg.ringR ?? 60, hw = 3, jr = 10, buf = 3, sep = cfg.sep ?? 300, tr = cfg.tr ?? 4, cy = N / 2;
  const l = await makeLab(GS_PINGPONG2, N, { ...cfg.g }, 'rest');
  const { state, params } = await l.sim.readRegion(0, 0, N, N);
  const S4 = l.layout.S * 4, P4 = l.layout.P * 4, pn = l.layout.paramNames, rg = l.layout.reagents;
  const P = (n: string) => pn.indexOf(n), Rg = (n: string) => rg.indexOf(n), ia = Rg('a'), ib = Rg('b'), ih = Rg('h');
  const units = [{ cx: N / 2 - sep / 2, dir: 1, t: 1 }, { cx: N / 2 + sep / 2, dir: -1, t: 2 }];
  const withRings = cfg.rings ?? true;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    params[i * P4 + P('k')] = 0.075;
    const edge = Math.min(x, N - 1 - x, y, N - 1 - y);
    // (plus a weak damping everywhere, so old echoes die out round after round)
    params[i * P4 + P('sponge')] = (cfg.damp ?? 0) + (edge < 30 ? 0.3 * ((30 - edge) / 30) ** 2 : 0);
    let fill = false;
    for (const { cx, dir, t } of units) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, jd = Math.hypot(dx - dir * ringR, dy);
      if (withRings && Math.abs(Math.hypot(dx, dy) - ringR) <= hw && jd > jr + buf) { params[i * P4 + P('k')] = 0.057; fill = true; }
      if (withRings && jd <= jr) params[i * P4 + P('k')] = 0.058; // the door, started open (empty)
      if (Math.hypot(dx, dy) <= tr) {
        params[i * P4 + P('trig')] = t;
        if (t === 1) state[i * S4 + ih] = 0.5; // A fires first
      }
    }
    state[i * S4 + ia] = fill ? 0.4 : 1;
    state[i * S4 + ib] = fill ? 0.3 : 0;
  }
  l.sim.writeRegion(0, 0, N, N, params, state);
  const at = (s: Float32Array, u: number, ri: number) => s[(cy * N + Math.round(units[u].cx)) * S4 + ri];
  // the most h anywhere in a trigger
  const hMax = (s: Float32Array, u: number) => {
    let m = -1;
    for (let y = -tr; y <= tr; y++) for (let x = -tr; x <= tr; x++) if (x * x + y * y <= tr * tr) m = Math.max(m, s[((cy + y) * N + Math.round(units[u].cx) + x) * S4 + ih]);
    return m;
  };
  const doorB = (s: Float32Array, u: number) => {
    const dxc = Math.round(units[u].cx + units[u].dir * ringR);
    let n = 0, sum = 0;
    for (let y = -jr; y <= jr; y++) for (let x = -jr; x <= jr; x++) if (x * x + y * y <= jr * jr) { n++; sum += s[((cy + y) * N + dxc + x) * S4 + ib]; }
    return sum / n;
  };
  const steps = cfg.steps ?? 8000, every = cfg.every ?? 10;
  const firing = [true, false], fires: string[] = [], Emax = [0, 0];
  for (let n = every; n <= steps; n += every) {
    await l.run(every);
    if (cfg.closeAt && n === cfg.closeAt) {
      const { state: s, params: p } = await l.sim.readRegion(0, 0, N, N), dxc = Math.round(units[0].cx + ringR);
      for (let y = -jr; y <= jr; y++) for (let x = -jr; x <= jr; x++) if (x * x + y * y <= jr * jr) {
        const i = ((cy + y) * N + dxc + x) * S4; s[i + ia] = 0.4; s[i + ib] = 0.3;
      }
      l.sim.writeRegion(0, 0, N, N, p, s);
      log(`step ${n}: closed A's door`);
    }
    const { state: s } = await l.read();
    for (let u = 0; u < 2; u++) {
      const h = hMax(s, u), E = at(s, u, Rg(u ? 'u1' : 'u2')) ** 2;
      Emax[u] = Math.max(Emax[u], E);
      if (!firing[u] && h > 0.25) { firing[u] = true; fires.push(`${'AB'[u]}@${n}`); }
      if (firing[u] && h < 0.05) firing[u] = false;
    }
    if (n % 1000 === 0) {
      log(`step ${n}: fires ${fires.join(' ') || 'none'}; peak E at A ${Emax[0].toExponential(1)}, at B ${Emax[1].toExponential(1)}; g ${at(s, 0, Rg('g')).toFixed(2)}/${at(s, 1, Rg('g')).toFixed(2)}; doors b ${withRings ? doorB(s, 0).toFixed(2) + '/' + doorB(s, 1).toFixed(2) : '-'}`);
      fires.length = 0; Emax[0] = Emax[1] = 0;
    }
    // video: every `video` steps, the walls white, u1 (A's) orange and u2 (B's) blue, the triggers' h green
    if (cfg.video && n % cfg.video === 0) {
      const f = String(n / cfg.video).padStart(4, '0');
      await saveFrame(`video/f${f}.png`, l, { ri: ib, lo: 0, hi: 1, scale: 1, caption: `step ${n}${cfg.closeAt && n >= cfg.closeAt ? '  (A\'s door closed)' : ''}`,
        mix: [{ ri: ib, lo: 0, hi: 0.3, color: [200, 200, 190] }, { ri: Rg('u1'), lo: 0, hi: 0.05, abs: true, color: [255, 140, 30] },
          { ri: Rg('u2'), lo: 0, hi: 0.05, abs: true, color: [40, 140, 255] }, { ri: ih, lo: 0, hi: 0.5, color: [60, 255, 90] }] });
    }
    if (n === 600) await saveFrame('pp2-u1-600.png', l, { ri: Rg('u1'), lo: -0.05, hi: 0.05, scale: 1, caption: 'u1 at 600' });
  }
  await saveFrame('pp2-b.png', l, { ri: ib, lo: 0, hi: 0.4, scale: 1, caption: `b at ${steps}` });
}
