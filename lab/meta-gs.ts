// metaGrayScott (Dan's Ready family): Gray-Scott whose F, k, D_a, D_b are offset
// by four extra reagents (c d e f) that b and (1-a-b) emit into, which decay and
// diffuse. Runs from the rule's generator (or seeds) and saves frames of b plus
// the four meta fields over time, with field statistics.
import { loadBundled } from '../src/ready';
import { makeLab, runAll, saveFrame, log } from './lab';

export default async function (cfg: { N?: number; steps?: number; every?: number; set?: Record<string, number>; tag?: string }) {
  const N = cfg.N ?? 512, steps = cfg.steps ?? 60000, every = cfg.every ?? 10000, tag = cfg.tag ?? 'run';
  const imp = await loadBundled('metaGrayScott_timeworms');
  log('warnings', imp.warnings);
  const lab = await makeLab(imp.rule, N, cfg.set ?? {}, 'initial');
  const R = imp.rule.reagents, S4 = lab.sim.layout.S * 4;
  const t0 = performance.now();
  for (let t = every; t <= steps; t += every) {
    await runAll([lab], every);
    const { state } = await lab.read();
    const range: [number, number][] = [];
    const stats = R.map((r, k) => {
      let lo = Infinity, hi = -Infinity, sum = 0, nan = 0;
      for (let i = 0; i < N * N; i++) {
        const v = state[i * S4 + k];
        if (!Number.isFinite(v)) { nan++; continue; }
        lo = Math.min(lo, v); hi = Math.max(hi, v); sum += v;
      }
      range.push([lo, hi]);
      return `${r} ${lo.toFixed(3)}..${hi.toFixed(3)} μ${(sum / (N * N)).toFixed(3)}${nan ? ` NaN${nan}` : ''}`;
    });
    log(t, `${((performance.now() - t0) / 1000).toFixed(0)}s`, stats.join(' | '));
    for (const k of [1, 2, 3, 4, 5]) {
      const [lo, hi] = range[k];
      await saveFrame(`${tag}-${String(t).padStart(7, '0')}-${R[k]}.png`, lab, { ri: k, lo, hi: hi > lo ? hi : lo + 1, scale: 1, caption: `${R[k]} ${lo.toFixed(2)}..${hi.toFixed(2)} @${t}` });
    }
  }
}
