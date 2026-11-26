// node lab/run.mjs advection-schemes
// The advection schemes on their reversing-swirl test: at each whole period the dye should be the checkerboard again;
// logs each one's mean error from it and its range (overshoot), and saves frames at half and whole periods.
import * as R from '../src/rule';
import { makeLab, runAll, saveFrame, log } from './lab';

export default async function (cfg: { periods?: number; globals?: Record<string, number> }) {
  const N = 256, rules = [R.ADVECT_UPWIND, R.ADVECT_LAX_WENDROFF, R.ADVECT_LIMITED, R.ADVECT_SL_BILINEAR, R.ADVECT_SL_CUBIC];
  const labs = [];
  for (const r of rules) labs.push(await makeLab(r, N, cfg.globals ?? {}, 'initial'));
  // the same swirl for all
  const s0 = await labs[0].read();
  for (const l of labs.slice(1)) l.sim.load(s0.state, s0.params);
  const g = labs[0].globals, half = Math.round(g.period / g.timestep / 2);
  const S4 = labs[0].layout.S * 4;
  const dye0 = Array.from({ length: N * N }, (_, c) => s0.state[c * S4]);
  for (let h = 1; h <= 2 * (cfg.periods ?? 2); h++) {
    await runAll(labs, half);
    const line = [];
    for (const [i, l] of labs.entries()) {
      const { state } = await l.read();
      let err = 0, lo = Infinity, hi = -Infinity;
      for (let c = 0; c < N * N; c++) { const d = state[c * S4]; err += Math.abs(d - dye0[c]); lo = Math.min(lo, d); hi = Math.max(hi, d); }
      line.push(`${rules[i].name.replace('Advection: ', '')}: err ${(err / N / N).toFixed(3)} range ${lo.toFixed(2)}…${hi.toFixed(2)}`);
      await saveFrame(`s${i}-h${h}.png`, l, { ri: 0, lo: 0, hi: 1, scale: 1, caption: `${rules[i].name.replace('Advection: ', '')} · ${h / 2} periods` });
    }
    log(`${h / 2} periods\n  ${line.join('\n  ')}`);
  }
}
