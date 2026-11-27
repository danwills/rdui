// node lab/run.mjs smoke-jet '{"speed":0.5}'
// Push (Jet) on Schrödinger's Smoke: a still fluid (uniform ψ1, a little ψ2), a dye blob, and a paddle drag rightwards
// through it at `speed` cells per time, a little each step as a finger's would be: the dye should go right, vortices
// shed off the paddle's sides (cores, ψ1 near 0), nothing NaN. Then right-drags (brake) over the same path.
import * as R from '../src/rule';
import { BrushMode } from '../src/sim';
import { makeLab, saveFrame, log } from './lab';

export default async function (cfg: { speed?: number; radius?: number }) {
  const N = 256, speed = cfg.speed ?? 0.5, radius = cfg.radius ?? 12;
  const l = await makeLab(R.SCHRODINGER_SMOKE, N);
  const L = l.layout, S4 = L.S * 4, ix = (n: string) => L.reagents.indexOf(n);
  const [ia1, ib1, ia2, ib2, id, ic] = ['a1', 'b1', 'a2', 'b2', 'dye', 'core'].map(ix);
  const { state } = await l.read();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = (y * N + x) * S4;
    state[c + ia1] = Math.sqrt(1 - 0.04); state[c + ib1] = 0; state[c + ia2] = 0.2; state[c + ib2] = 0;
    state[c + id] = Math.hypot(x - 100, y - 128) < 14 ? 1 : 0;
  }
  l.sim.writeRegion(0, 0, N, N, undefined, state);
  const ts = l.globals.timestep ?? 3;
  const stats = async (t: string) => {
    const { state: s } = await l.read();
    let dye = 0, mx = 0, nan = 0, cores = 0;
    for (let c = 0; c < N * N; c++) {
      const v = s[c * S4 + id];
      if (!Number.isFinite(v) || !Number.isFinite(s[c * S4 + ia1])) { nan++; continue; }
      dye += v; mx += v * (c % N);
      if (s[c * S4 + ic] > 0.5) cores++;
    }
    log(`${t}: dye ${dye.toFixed(0)} at x ${(mx / dye).toFixed(1)}, core cells ${cores}, NaN ${nan}`);
  };
  await stats('start');
  // the drag: from x 70 to 140 along y 128, speed·timestep cells each step (3 passes)
  const drag = async (alt: boolean) => {
    for (let x = 70; x < 140; x += speed * ts) {
      l.sim.brushAll([{ ax: x, ay: 128, bx: x + speed * ts, by: 128, radius, mode: BrushMode.Jet, strength: 1, hardness: 0.5, paint: [], pushSpeed: speed, clear: alt }]);
      await l.run(3);
    }
  };
  await drag(false);
  await stats('after the drag');
  await saveFrame(`jet-${speed}-dye.png`, l, { ri: id, lo: 0, hi: 1, scale: 2, caption: `dye, drag at ${speed}` });
  await saveFrame(`jet-${speed}-core.png`, l, { ri: ic, lo: 0, hi: 1, scale: 2, caption: 'cores' });
  for (const n of [150, 300]) { await l.run(n); await stats(`+${n} passes`); }
  await saveFrame(`jet-${speed}-later.png`, l, { ri: id, lo: 0, hi: 1, scale: 2, caption: 'dye later' });
}
