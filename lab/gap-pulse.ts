// node lab/run.mjs gap-pulse '{"steps":6000,"th":11,"g":{"ce":1,"ea":0.05,"wall":10,"door_kill":5,"eps":0.001}}'
// (those settings: the pulse laps every ~1700 steps; the door opens fully for ~400 of them and the energy inside goes
// from ~5e-3 to ~50, against ~21 with the door held open ("open":true) and ~4e-3 held shut ("pulse":false).
// "video":20 with "every":20 for frames in lab/out/gap-pulse/video/.)
// Gap junction, Dan's version: a continuous wave source outside a ring wall with a door in it (the ring worm and door
// of gap-door.ts, but with no dead cells between: the ring's ends grow back into an emptied door), opened by a pulse
// that runs round the wall. The pulse is an excitable wave (e, r: FitzHugh–Nagumo) living only on a track along the
// ring; where it crosses the door it adds to the door's kill rate, the blob dies and the door is open until the ring
// closes it again behind the pulse. Does the source's wave get in only while the door is open?
import * as R from '../src/rule';
import { makeLab, saveFrame, log } from './lab';

const GS_PULSE_DOOR: R.RuleDef = {
  ...R.GRAY_SCOTT,
  name: 'Gray-Scott pulse-opened door (lab)',
  reagents: ['a', 'b', 'u', 'v', 'e', 'r', 'clock'],
  params: [...R.GRAY_SCOTT.params, { name: 'c2', value: 0.3, min: 0, max: 0.45 }, { name: 'wall', value: 5, min: 0, max: 20 },
    { name: 'sponge', value: 0, min: 0, max: 1 }, { name: 'track', value: 0, min: 0, max: 1 }, { name: 'doorm', value: 0, min: 0, max: 1 },
    { name: 'emit', value: 0, min: 0, max: 2 }, { name: 'omega', value: 0.2094, min: 0, max: 1 },
    { name: 'D_e', value: 0.3, min: 0, max: 0.35 }, { name: 'ce', value: 0.5, min: 0, max: 1 }, { name: 'ea', value: 0.1, min: 0, max: 0.5 },
    { name: 'eps', value: 0.004, min: 0, max: 0.1 }, { name: 'gr', value: 2.5, min: 0, max: 4.5 }, { name: 'door_kill', value: 0.3, min: 0, max: 1 }],
  paintable: ['k', 'sponge', 'track', 'doorm', 'emit'],
  formula: `delta_a = D * D_a * laplacian_a - a*b*b + F*(1.0 - a);
// (the pulse kills the door implicitly, so it can be strong)
delta_b = D * D_b * laplacian_b + a*b*b - (F + k)*b + (b/(1.0 + timestep*doorm*door_kill*max(e, 0.0)) - b)/timestep;
// the pulse round the wall: excitable e with slow recovery r, only on the track
delta_e = track*(D_e*laplacian_e + ce*(e*(1.0 - e)*(e - ea) - r));
delta_r = track*eps*(e - gr*r);
delta_v = ((v + timestep*(c2*laplacian_u + emit*sin(omega*clock)))/(1.0 + timestep*(sponge + wall*b)) - v)/timestep;
delta_u = (v + timestep*(c2*laplacian_u + emit*sin(omega*clock)))/(1.0 + timestep*(sponge + wall*b));
delta_clock = 1.0;`,
  rest: [1, 0, 0, 0, 0, 0, 0],
  seed: [0.5, 0.25, null, null, null, null, null],
  seedNoise: [0, 0.25, 0, 0, 0, 0, 0],
  view: { reagent: 'b', low: 0, high: 0.4 },
};

export default async function (cfg: { steps?: number; every?: number; video?: number; dk?: number; th?: number; emit?: number; pulse?: boolean; open?: boolean; g?: Record<string, number> }) {
  const N = 512, ringR = 80, hw = 3, th = cfg.th ?? 6, jr = 10, cx = 300, cy = N / 2, sx = 110;
  const l = await makeLab(GS_PULSE_DOOR, N, { ...cfg.g }, 'rest');
  const { state, params } = await l.sim.readRegion(0, 0, N, N);
  const S4 = l.layout.S * 4, P4 = l.layout.P * 4, pn = l.layout.paramNames, rg = l.layout.reagents;
  const P = (n: string) => pn.indexOf(n), Rg = (n: string) => rg.indexOf(n), ia = Rg('a'), ib = Rg('b'), ie = Rg('e'), ir = Rg('r');
  // the door faces the source, on the ring's left; the pulse starts opposite it, heading anticlockwise (one way: the
  // track behind it starts refractory)
  const dX = cx - ringR;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, dx = x + 0.5 - cx, dy = y + 0.5 - cy, rr = Math.hypot(dx, dy), jd = Math.hypot(x + 0.5 - dX, dy);
    const edge = Math.min(x, N - 1 - x, y, N - 1 - y);
    params[i * P4 + P('sponge')] = 0.002 + (edge < 30 ? 0.3 * ((30 - edge) / 30) ** 2 : 0);
    const band = Math.abs(rr - ringR) <= hw, junc = jd <= jr;
    // (open: a reference with the door held open, dead and empty)
    params[i * P4 + P('k')] = junc ? (cfg.open ? 0.075 : cfg.dk ?? 0.05) : band ? 0.057 : 0.075;
    params[i * P4 + P('doorm')] = junc ? 1 : 0;
    const onTrack = Math.abs(rr - ringR) <= th;
    params[i * P4 + P('track')] = onTrack ? 1 : 0;
    if (Math.hypot(x + 0.5 - sx, dy) <= 4) params[i * P4 + P('emit')] = cfg.emit ?? 0.3;
    const fill = cfg.open ? band && !junc : band || junc;
    state[i * S4 + ia] = fill ? 0.4 : 1;
    state[i * S4 + ib] = fill ? 0.3 : 0;
    if (onTrack && (cfg.pulse ?? true) && dx > 0) {
      const ang = Math.atan2(dy, dx) * 180 / Math.PI; // 0 opposite the door
      if (ang > -6 && ang <= 6) state[i * S4 + ie] = 1;
      if (ang > 6 && ang <= 40) state[i * S4 + ir] = 0.25; // refractory behind (anticlockwise in y-down = negative angle ahead)
    }
  }
  l.sim.writeRegion(0, 0, N, N, params, state);
  const disc = (s: Float32Array, ox: number, oy: number, r: number, ri: number) => {
    let n = 0, sum = 0;
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) { n++; sum += s[((oy + y) * N + ox + x) * S4 + ri]; }
    return sum / n;
  };
  const inner = ringR - hw - 4, iu = Rg('u'), iv = Rg('v');
  const energyIn = (s: Float32Array) => {
    let e = 0;
    for (let y = -inner; y <= inner; y++) for (let x = -inner; x <= inner; x++) if (x * x + y * y <= inner * inner) { const i = ((cy + y) * N + cx + x) * S4; e += s[i + iv] ** 2 + 0.03 * s[i + iu] ** 2; }
    return e;
  };
  const steps = cfg.steps ?? 8000, every = cfg.every ?? 100;
  let eSum = 0, eN = 0;
  for (let n = every; n <= steps; n += every) {
    await l.run(every);
    const { state: s } = await l.read();
    const db = disc(s, dX, cy, jr, ib), de = disc(s, dX, cy, jr, ie);
    if (n > steps / 2) { eSum += energyIn(s); eN++; }
    // where the pulse is: the angle of the most e on the track's centre line
    let best = -1, at = 0;
    for (let a = 0; a < 360; a += 3) { const t = a * Math.PI / 180, v = s[(Math.round(cy + ringR * Math.sin(t)) * N + Math.round(cx + ringR * Math.cos(t))) * S4 + ie]; if (v > best) { best = v; at = a; } }
    if (n % (every * 2) === 0 || cfg.every) log(`step ${n}: door b ${db.toFixed(2)} ${db < 0.12 ? 'OPEN  ' : 'closed'} e ${de.toFixed(2)} | pulse ${best > 0.3 ? `at ${at}°` : 'none'} | energy inside ${energyIn(s).toExponential(1)}`);
    if (cfg.video && n % cfg.video === 0) {
      await saveFrame(`video/f${String(n / cfg.video).padStart(4, '0')}.png`, l, { ri: ib, lo: 0, hi: 1, scale: 1, caption: `step ${n}  door ${db < 0.12 ? 'open' : 'closed'}`,
        mix: [{ ri: ib, lo: 0, hi: 0.3, color: [200, 200, 190] }, { ri: iu, lo: 0, hi: 0.4, abs: true, color: [60, 150, 255] }, { ri: ie, lo: 0, hi: 1, color: [255, 90, 40] }] });
    }
  }
  log(`mean energy inside over the second half: ${(eSum / eN).toExponential(2)}`);
  await saveFrame('pulse-door.png', l, { ri: ib, lo: 0, hi: 1, scale: 1, caption: `step ${steps}`, mix: [{ ri: ib, lo: 0, hi: 0.3, color: [200, 200, 190] }, { ri: iu, lo: 0, hi: 0.4, abs: true, color: [60, 150, 255] }, { ri: ie, lo: 0, hi: 1, color: [255, 90, 40] }] });
}
