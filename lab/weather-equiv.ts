// Gray-Scott Weather with every coupling 0 should be Meta Gray-Scott (F_forget 0), fields scaled by their gains.
import * as R from '../src/rule';
import { makeLab, runAll, log } from './lab';

export default async function () {
  const N = 128, set = { F_gain: 0.18, F_mem: 140000, F_reach: 11, F_diff: 0.9, k_gain: 0, Da_gain: 0.31, Da_mem: 22000, Da_reach: 1.07, Da_diff: 0.5, Db_gain: 0.7, Db_mem: 117000, Db_reach: 1.4, Db_diff: 1.2 };
  const A = await makeLab(R.META_GS, N, { ...set, F_forget: 0 }, 'initial');
  const B = await makeLab(R.WEATHER_GS, N, set, 'initial');
  B.sim.load((await A.read()).state.slice(), (await B.read()).params);
  const S4 = A.layout.S * 4, g = [1, 1, set.F_gain, set.k_gain, set.Da_gain, set.Db_gain];
  for (const t of [1000, 5000]) {
    await runAll([A, B], t === 1000 ? 1000 : 4000);
    const x = (await A.read()).state, y = (await B.read()).state;
    log(t, [0, 1, 2, 4, 5].map((k) => { let m = 0; for (let i = 0; i < N * N; i++) m = Math.max(m, Math.abs(x[i * S4 + k] - y[i * S4 + k] * g[k])); return `${R.WEATHER_GS.reagents[k]} ${m.toExponential(1)}`; }).join(' '));
  }
}
