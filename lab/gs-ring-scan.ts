// Bubble hunt in plain Gray-Scott: one disk of b (radius r) stamped on the empty state for each (F, k)
// on a grid; frames side by side. Looking for a disk that hollows into a ring (a membrane round an empty
// inside) and keeps it: a bubble.
//   node lab/run.mjs gs-ring-scan '{"F":[0.02,0.03],"k":[0.055,0.06],"steps":10000}'
import * as R from '../src/rule';
import { makeLab, log, saveFrame } from './lab';

export default async function (cfg: { F: number[]; k: number[]; steps: number; r?: number; N?: number; tag?: string; hole?: boolean; pair?: number; at?: number[] }) {
  const N = cfg.N ?? 128, r = cfg.r ?? 18;
  for (const F of cfg.F) for (const k of cfg.k) {
    const lab = await makeLab(R.GRAY_SCOTT, N, { F, k });
    const S4 = lab.layout.S * 4, { state } = await lab.read();
    // one disk at the centre, or (pair: centre distance) two side by side
    const cs = cfg.pair ? [N / 2 - cfg.pair / 2, N / 2 + cfg.pair / 2] : [N / 2];
    for (const cx of cs) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (Math.hypot(x - cx, y - N / 2) <= r) { const i = (y * N + x) * S4; state[i] = 0.5; state[i + 1] = 0.25; }
    lab.sim.writeRegion(0, 0, N, N, undefined, state);
    let t = 0;
    for (const T of cfg.at ?? [cfg.steps]) {
      await lab.run(T - t); t = T;
      await saveFrame(`${cfg.tag ?? 'scan'}-F${F}-k${k}${cfg.at ? `-${T}` : ''}.png`, lab, { ri: 1, lo: 0, hi: 0.4, scale: 1, caption: `F ${F} k ${k}${cfg.at ? ` t=${T}` : ''}` });
    }
    lab.sim.destroy();
  }
  log('done');
}
