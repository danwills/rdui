// Do the History+Wave glider and soliton survive with the exact Laplacian?
import * as R from '../src/rule';
import { makeLab, blobs, log, STARTERS, HW_STD } from './lab';

export default async function () {
  for (const mode of ['stencil', 'spectral', 'spectral-exact'] as const) {
    const N = 256, rule = { ...R.GS_HISTORY_WAVE, laplacian: mode };
    const g = await makeLab(rule, N, HW_STD);
    await g.place(STARTERS('starter-glider-hw65'), 128, 128);
    await g.place(STARTERS('starter-soliton-hw65'), 128, 40);
    await g.run(1000);
    const b0 = blobs((await g.read()).state, N, g.layout.S, 1, 0.2);
    await g.run(4000);
    const b1 = blobs((await g.read()).state, N, g.layout.S, 1, 0.2);
    const desc = (bs: typeof b0) => bs.map((b) => `(${b.x.toFixed(0)},${b.y.toFixed(0)}) a${b.area}`).join(' ');
    log(`${mode}: t=1000 ${desc(b0)}  |  t=5000 ${desc(b1)}`);
    g.sim.destroy();
  }
}
