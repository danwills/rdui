// node lab/run.mjs u-cavity '{"steps":12000}'
// Dan's U cavity: waves from a source in the upper section get into a cavity through a gate (door 1, in the wall
// between them), bounce round inside, and leave through a second gate round the corner (door 2, in the cavity's right
// wall) into the lower section, which wraps round the cavity like a U. Every worm wall reflects (the wave pinned where
// there's b, -pin·b·u); only the edge sponges absorb. One pulse runs clockwise round a track along the cavity's walls
// and opens door 1, then door 2 about 1300 steps later (gap-pulse.ts's doors: the pulse kills the blob, the wall grows
// back over it).
import * as R from '../src/rule';
import { makeLab, saveFrame, log } from './lab';

const RULE: R.RuleDef = {
  ...R.GAP_JUNCTION,
  name: 'U cavity (lab)',
  params: [...R.GAP_JUNCTION.params.map((p) => (p.name === 'wall' ? { ...p, value: 0 } : p)), { name: 'pin', value: 2, min: 0, max: 50 }],
  formula: R.GAP_JUNCTION.formula.replaceAll('(c2*laplacian_u + emit*sin(omega*clock))', '(c2*laplacian_u - pin*b*u + emit*sin(omega*clock))'),
  initial: [],
};

export default async function (cfg: { steps?: number; every?: number; video?: number; pin?: number; inDamp?: number; g?: Record<string, number> }) {
  const N = 512, hw = 3, th = 11, jr = 10;
  // the cavity's walls (centre lines), the divider across the field, the doors and the source
  const X0 = 140, X1 = 372, Y0 = 170, Y1 = 340, d1 = [256, Y0], d2 = [X1, 300], src = [256, 80];
  const l = await makeLab(RULE, N, { pin: cfg.pin ?? 2, ...cfg.g }, 'rest');
  const { state, params } = await l.sim.readRegion(0, 0, N, N);
  const S4 = l.layout.S * 4, P4 = l.layout.P * 4, pn = l.layout.paramNames, rg = l.layout.reagents;
  const P = (n: string) => pn.indexOf(n), Rg = (n: string) => rg.indexOf(n);
  const ia = Rg('a'), ib = Rg('b'), iu = Rg('u'), iv = Rg('v'), ie = Rg('e'), ir = Rg('r');
  // distance to the cavity's rectangle outline, and whether a point is inside it
  const toRect = (x: number, y: number) => {
    const inX = x >= X0 && x <= X1, inY = y >= Y0 && y <= Y1;
    if (inX && inY) return Math.min(x - X0, X1 - x, y - Y0, Y1 - y);
    const dx = Math.max(X0 - x, 0, x - X1), dy = Math.max(Y0 - y, 0, y - Y1);
    return Math.hypot(dx, dy);
  };
  const inside = (x: number, y: number) => x > X0 + hw && x < X1 - hw && y > Y0 + hw && y < Y1 - hw;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, cx = x + 0.5, cy = y + 0.5, edge = Math.min(x, N - 1 - x, y, N - 1 - y);
    const wallLine = toRect(cx, cy) <= hw || (Math.abs(cy - Y0) <= hw && cx > 30 && cx < N - 30);
    const door = Math.hypot(cx - d1[0], cy - d1[1]) <= jr || Math.hypot(cx - d2[0], cy - d2[1]) <= jr;
    params[i * P4 + P('sponge')] = (inside(cx, cy) ? cfg.inDamp ?? 0.0005 : 0.002) + (edge < 30 ? 0.3 * ((30 - edge) / 30) ** 2 : 0);
    params[i * P4 + P('k')] = door ? 0.05 : wallLine ? 0.057 : 0.075;
    params[i * P4 + P('doorm')] = door ? 1 : 0;
    params[i * P4 + P('track')] = toRect(cx, cy) <= th ? 1 : 0;
    if (Math.hypot(cx - src[0], cy - src[1]) <= 4) params[i * P4 + P('emit')] = 0.3;
    const fill = wallLine || door;
    state[i * S4 + ia] = fill ? 0.4 : 1;
    state[i * S4 + ib] = fill ? 0.3 : 0;
    // the pulse: on the top wall left of door 1, heading right (clockwise), the track behind it refractory
    if (toRect(cx, cy) <= th && Math.abs(cy - Y0) <= th) {
      if (cx > 196 && cx <= 204) state[i * S4 + ie] = 1;
      if (cx > 150 && cx <= 196) state[i * S4 + ir] = 0.25;
    }
  }
  l.sim.writeRegion(0, 0, N, N, params, state);
  const disc = (s: Float32Array, [ox, oy]: number[], r: number, ri: number) => {
    let n = 0, sum = 0;
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) { n++; sum += s[((oy + y) * N + ox + x) * S4 + ri]; }
    return sum / n;
  };
  // wave energy (v²) in the upper section, the cavity, and the lower section (outside the cavity, below the divider)
  const energies = (s: Float32Array) => {
    const e = [0, 0, 0];
    for (let y = 30; y < N - 30; y += 2) for (let x = 30; x < N - 30; x += 2) {
      const i = (y * N + x) * S4, w = s[i + iv] ** 2;
      if (y < Y0 - hw - 2) e[0] += w;
      else if (inside(x, y)) e[1] += w;
      else if (toRect(x, y) > hw + 2 && y > Y0 + hw + 2) e[2] += w;
    }
    return e;
  };
  const steps = cfg.steps ?? 12000, every = cfg.every ?? 100;
  const was = [false, false], events: string[] = [];
  for (let n = every; n <= steps; n += every) {
    await l.run(every);
    const { state: s } = await l.read();
    const db = [disc(s, d1, jr, ib), disc(s, d2, jr, ib)], [eU, eC, eL] = energies(s);
    db.forEach((b, k) => { const open = b < 0.12; if (open !== was[k]) { events.push(`door ${k + 1} ${open ? 'opens' : 'shuts'} @${n}`); was[k] = open; } });
    if (n % (every * 5) === 0) log(`step ${n}: doors ${db.map((b) => (b < 0.12 ? 'OPEN' : 'shut')).join('/')} | energy upper ${eU.toExponential(1)} cavity ${eC.toExponential(1)} lower ${eL.toExponential(1)}`);
    if (cfg.video && n % cfg.video === 0) {
      await saveFrame(`video/f${String(n / cfg.video).padStart(4, '0')}.png`, l, { ri: ib, lo: 0, hi: 1, scale: 1, caption: `step ${n}  door 1 ${db[0] < 0.12 ? 'open' : 'shut'}, door 2 ${db[1] < 0.12 ? 'open' : 'shut'}`,
        mix: [{ ri: ib, lo: 0, hi: 0.3, color: [200, 200, 190] }, { ri: iu, lo: 0, hi: 0.4, abs: true, color: [60, 150, 255] }, { ri: ie, lo: 0, hi: 1, color: [255, 90, 40] }] });
    }
  }
  log(events.join(', '));
  await saveFrame('u-cavity.png', l, { ri: ib, lo: 0, hi: 1, scale: 1, caption: `step ${steps}`, mix: [{ ri: ib, lo: 0, hi: 0.3, color: [200, 200, 190] }, { ri: iu, lo: 0, hi: 0.4, abs: true, color: [60, 150, 255] }, { ri: ie, lo: 0, hi: 1, color: [255, 90, 40] }] });
}
