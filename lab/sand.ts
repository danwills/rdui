// node lab/run.mjs sand '{"rule":"SAND_RIPPLES"}'
// Runs a Sand rule: logs each height field's range and mean (mass) and the ripple spacing along the wind, saves the shade.
import * as R from '../src/rule';
import { makeLab, saveFrame, log } from './lab';

export default async function (cfg: { rule?: string; N?: number; steps?: number; parts?: number; globals?: Record<string, number>; fields?: string[]; show?: string }) {
  const rule = (R as unknown as Record<string, R.RuleDef>)[cfg.rule ?? 'SAND_RIPPLES'];
  const N = cfg.N ?? rule.size?.width ?? 512, parts = cfg.parts ?? 4;
  const l = await makeLab(rule, N, cfg.globals ?? {}, 'initial');
  const S4 = l.layout.S * 4, fields = cfg.fields ?? ['h'];
  for (let k = 0; k <= parts; k++) {
    if (k) await l.run(Math.round((cfg.steps ?? 2000) / parts));
    const { state } = await l.read();
    const line = fields.map((f) => {
      const i = l.layout.reagents.indexOf(f);
      let lo = Infinity, hi = -Infinity, sum = 0, bad = 0;
      for (let c = 0; c < N * N; c++) { const v = state[c * S4 + i]; if (!Number.isFinite(v)) bad++; lo = Math.min(lo, v); hi = Math.max(hi, v); sum += v; }
      // spacing: the first peak of the autocorrelation along x, over all rows
      const mean = sum / N / N;
      let best = 0, bestLag = 0;
      for (let lag = 3; lag < 200; lag++) {
        let a = 0;
        for (let y = 0; y < N; y += 4) for (let x = 0; x < N; x++) a += (state[(y * N + x) * S4 + i] - mean) * (state[(y * N + (x + lag) % N) * S4 + i] - mean);
        if (a > best) { best = a; bestLag = lag; }
        else if (bestLag && lag > bestLag * 1.5) break;
      }
      let smax = 0, ssum = 0;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const s = Math.abs(state[(y * N + (x + 1) % N) * S4 + i] - state[(y * N + x) * S4 + i]); smax = Math.max(smax, s); ssum += s; }
      return `${f} ${lo.toFixed(2)}…${hi.toFixed(2)} slope mean ${(ssum / N / N).toFixed(3)} max ${smax.toFixed(2)}… mean ${mean.toFixed(4)} spacing ${bestLag}${bad ? ` NaN ${bad}` : ''}`;
    });
    log(`@${k}: ${line.join(' · ')}`);
    await saveFrame(`${cfg.rule ?? 'SAND_RIPPLES'}-${k}.png`, l, { ri: cfg.show ? l.layout.reagents.indexOf(cfg.show) : 0, lo: 0, hi: 1, scale: 1, caption: `@${k}` });
  }
}
