// node lab/run.mjs fluid-schemes
// The Fluid swirls variants (each advection scheme) and Stable fluids (cubic), each from its own start, over the same time:
// logs the spin left, the dye's contrast and range, and saves frames.
import * as R from '../src/rule';
import { makeLab, saveFrame, log } from './lab';

export default async function (cfg: { time?: number; parts?: number }) {
  const parts = cfg.parts ?? 4;
  const rules = [R.STABLE_FLUIDS, R.FLUID_BILINEAR, R.FLUID_UPWIND, R.FLUID_LAX_WENDROFF, R.FLUID_LIMITED];
  const labs = [];
  for (const r of rules) labs.push(await makeLab(r, r.size?.width ?? 512, {}, 'initial'));
  for (let k = 0; k <= parts; k++) {
    const line = [];
    for (const [i, l] of labs.entries()) {
      if (k) await l.run(Math.round((cfg.time ?? 600) / parts / l.globals.timestep));
      const { state } = await l.read();
      const S4 = l.layout.S * 4, N = l.N;
      let w2 = 0, dv = 0, lo = Infinity, hi = -Infinity, bad = 0;
      for (let c = 0; c < N * N; c++) { const w = state[c * S4], d = state[c * S4 + 1]; if (!Number.isFinite(w + d)) bad++; w2 += w * w; dv += (d - 0.5) ** 2; lo = Math.min(lo, d); hi = Math.max(hi, d); }
      log(`  ${rules[i].name} @${k}: max|u| ${Array.from({ length: N * N }, (_, c) => Math.hypot(state[c * S4 + 2] || 0, state[c * S4 + 3] || 0)).reduce((a, b) => Math.max(a, b), 0).toFixed(2)}`);
      line.push(`${rules[i].name}: rms ω ${Math.sqrt(w2 / N / N).toFixed(4)} contrast ${Math.sqrt(dv / N / N).toFixed(3)} dye ${lo.toFixed(2)}…${hi.toFixed(2)}${bad ? ` NaN ${bad}` : ''}`);
      if (!bad) await saveFrame(`r${i}-${k}.png`, l, { ri: 1, lo: 0, hi: 1, scale: 1, caption: `${rules[i].name.replace('Fluid swirls: ', '')} @${k}` });
    }
    log(`@${k}\n  ${line.join('\n  ')}`);
  }
}
