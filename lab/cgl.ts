// node lab/run.mjs cgl '{"rule":"CGL_SPIRALS"}'
// A CGL rule from its start: defects (cells with |A| < 0.3, and a rough count of cores) and the size's spread over
// time, NaN checked, and frames of the phase.
import * as R from '../src/rule';
import { makeLab, saveFrame, log } from './lab';

export default async function (cfg: { rule: string; steps?: number; size?: number }) {
  const rule = (R as unknown as Record<string, R.RuleDef>)[cfg.rule];
  const N = cfg.size ?? 256;
  const l = await makeLab(rule, N, {}, 'initial');
  const S4 = l.layout.S * 4, ia = l.layout.reagents.indexOf('amp'), ip = l.layout.reagents.indexOf('phase');
  const total = cfg.steps ?? 8000;
  for (let n = 0, k = 0; n <= total; n += total / 8, k++) {
    if (n) await l.run(total / 8);
    const { state: s } = await l.read();
    let low = 0, nan = 0, sum = 0, sq = 0, cores = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const c = (y * N + x) * S4, a = s[c + ia];
      if (!Number.isFinite(a)) { nan++; continue; }
      sum += a; sq += a * a;
      if (a < 0.3) low++;
      // a core: a local minimum of the size, below 0.5
      if (a < 0.5 && x > 0 && y > 0 && x < N - 1 && y < N - 1) {
        let min = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) if (s[((y + dy) * N + x + dx) * S4 + ia] < a) min = false;
        if (min) cores++;
      }
    }
    const m = sum / (N * N);
    log(`${rule.name} step ${n}: cores ${cores}, cells |A|<0.3 ${low}, mean |A| ${m.toFixed(3)} ± ${Math.sqrt(Math.max(0, sq / (N * N) - m * m)).toFixed(3)}, NaN ${nan}`);
    if (k % 4 === 0) await saveFrame(`${cfg.rule}-${n}.png`, l, { ri: ip, lo: 0, hi: 1, scale: 2, caption: `${rule.name} ${n}` });
  }
}
