// node lab/run.mjs gap-toggle '{"cases":[[3,false,"seed",4],...]}'
// Gap-junction step 3: can a pulse flip the bistable junction (gap-ring.ts: ring worm F 0.06 k 0.057, junction disc
// F 0.06 k 0.0635)? Each quadrant settles a ring with its junction on or off, then gets a kick at the junction centre:
// seed (b painted in a disc of radius r), loop (b in a ring 3 cells wide out to radius r, the on state's shape) or erase (a disc of radius r wiped back to a=1, b=0). Which way does it settle?
import * as R from '../src/rule';
import { makeLab, saveFrame, log } from './lab';

type Kick = 'seed' | 'erase' | 'loop' | 'none';
export default async function (cfg: { settle?: number; after?: number; worm?: [number, number]; blob?: [number, number]; jr?: number; R?: number; at?: number; cases?: [number, boolean, Kick, number][] }) {
  const N = 512, Q = 256, ringR = cfg.R ?? 80, jr = cfg.jr ?? 14;
  const [wF, wk] = cfg.worm ?? [0.06, 0.057], [bF, bk] = cfg.blob ?? [0.06, 0.0635];
  const l = await makeLab(R.GRAY_SCOTT, N, {}, 'rest');
  const { state, params } = await l.sim.readRegion(0, 0, N, N);
  const S4 = l.layout.S * 4, P4 = l.layout.P * 4, iF = l.layout.paramNames.indexOf('F'), ik = l.layout.paramNames.indexOf('k');
  const ia = l.layout.reagents.indexOf('a'), ib = l.layout.reagents.indexOf('b');
  const cases = cfg.cases ?? [[3, false, 'seed', 4], [3, false, 'seed', 8], [3, true, 'erase', 4], [3, true, 'erase', 8]];
  // where the kick lands: the junction centre, or `at` cells along the ring past it
  const at = cfg.at ?? 0;
  const origin = (q: number) => [(q % 2) * Q + Q / 2, Math.floor(q / 2) * Q + Q / 2];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const q = (y >= Q ? 2 : 0) + (x >= Q ? 1 : 0), [hw, on] = cases[q];
    const dx = (x % Q) - Q / 2 + 0.5, dy = (y % Q) - Q / 2 + 0.5, rr = Math.hypot(dx, dy);
    const band = Math.abs(rr - ringR) <= hw, junc = Math.hypot(dx - ringR, dy) <= jr;
    const i = y * N + x;
    params[i * P4 + iF] = junc ? bF : wF;
    params[i * P4 + ik] = junc ? bk : band ? wk : 0.075;
    const fill = junc ? on : band;
    state[i * S4 + ia] = fill ? 0.4 : 1;
    state[i * S4 + ib] = fill ? 0.3 : 0;
  }
  l.sim.writeRegion(0, 0, N, N, params, state);
  const junctionB = (s: Float32Array, q: number) => {
    const [ox, oy] = origin(q);
    let n = 0, sum = 0;
    for (let y = -jr; y <= jr; y++) for (let x = -jr; x <= jr; x++) if (x * x + y * y <= jr * jr) { n++; sum += s[((oy + y) * N + ox + ringR + x) * S4 + ib]; }
    return sum / n;
  };
  const report = (s: Float32Array) => cases.map(([, on, k, r], q) => `${on ? 'on' : 'off'} ${k} r${r}: ${junctionB(s, q).toFixed(3)}`).join(' | ');
  await l.run(cfg.settle ?? 10000);
  const settled = await l.read();
  log(`settled: ${report(settled.state)}`);
  await saveFrame('toggle-before.png', l, { ri: ib, lo: 0, hi: 0.4, scale: 1, caption: 'before the kicks' });
  const { state: s, params: p } = await l.sim.readRegion(0, 0, N, N);
  cases.forEach(([, , kick, r], q) => {
    if (kick === 'none') return;
    const [ox, oy] = origin(q), t = at / ringR, cx = ox + ringR * Math.cos(t), cy = oy + ringR * Math.sin(t);
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > r) continue;
      const i = (y * N + x) * S4, paint = kick === 'seed' || (kick === 'loop' && d > r - 3);
      s[i + ia] = paint ? 0.4 : 1;
      s[i + ib] = paint ? 0.3 : 0;
    }
  });
  l.sim.writeRegion(0, 0, N, N, p, s);
  const after = cfg.after ?? 20000;
  for (let n = 1; n <= 4; n++) {
    await l.run(after / 4);
    const { state: s2 } = await l.read();
    log(`+${(n * after) / 4}: ${report(s2)}`);
  }
  await saveFrame('toggle.png', l, { ri: ib, lo: 0, hi: 0.4, scale: 1, caption: cases.map(([, o, k, r]) => `${o ? 'on' : 'off'} ${k} r${r}`).join(' | ') });
}
