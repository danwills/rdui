// Sealed vs feed walls: a strip of each across a field of b = 0.5, then how a and b sit beside them.
//   node lab/run.mjs wall-feed '{}'
import * as R from '../src/rule';
import { makeLab, log } from './lab';

export default async function () {
  for (const rule of [R.GRAY_SCOTT, R.GRAY_SCOTT_ZOOM]) {
    const N = 128, lab = await makeLab(rule, N, {}, 'rest');
    const S4 = lab.layout.S * 4, P4 = lab.layout.P * 4;
    const { state, params } = await lab.read();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const flag = x >= 30 && x < 34 ? 1 : x >= 94 && x < 98 ? 2 : 0;
      params[i * P4] = flag;
      state[i * S4] = flag ? 1 : 0.3; state[i * S4 + 1] = flag ? 0 : 0.5;
    }
    lab.sim.load(state, params);
    await lab.run(40);
    const out = await lab.read();
    const at = (x: number) => { const i = 64 * N + x; return `a ${out.state[i * S4].toFixed(3)} b ${out.state[i * S4 + 1].toFixed(3)}`; };
    log(`${rule.name}: beside sealed (x=34) ${at(34)} | beside feed (x=98) ${at(98)} | far (x=64) ${at(64)} | finite ${out.state.every(Number.isFinite)}`);
  }
}
