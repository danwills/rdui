// Run a rule (built-in index or a Ready fixture) from its initial pattern and
// record frames; reports value range so blow-ups are obvious.
import * as R from '../src/rule';
import { importReady } from '../src/ready';
import { makeLab, saveFrame, log } from './lab';

export default async function (cfg: { builtin?: number; fixture?: string; globals?: Record<string, number>; N?: number; steps: number; every: number; lo?: number; hi?: number; tag: string }) {
  let rule: R.RuleDef;
  if (cfg.fixture) {
    const imp = await importReady(await (await fetch(`/lab/fixtures/${cfg.fixture}.vti`)).text(), cfg.fixture);
    rule = imp.rule;
    if (imp.warnings.length) log('warnings:', imp.warnings.join('; '));
  } else rule = R.BUILTIN_RULES[cfg.builtin!];
  const N = cfg.N ?? 256;
  const lab = await makeLab(rule, N, cfg.globals ?? {}, 'initial');
  for (let t = 0, f = 0; t <= cfg.steps; t += cfg.every, f++) {
    if (t) await lab.run(cfg.every);
    const { state } = await lab.read();
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < N * N; i++) { const v = state[i * lab.layout.S * 4]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (f % 10 === 0) log(`t=${t} range ${lo.toFixed(3)}..${hi.toFixed(3)}`);
    await saveFrame(`${cfg.tag}/f${String(f).padStart(4, '0')}.png`, lab, { ri: 0, lo: cfg.lo ?? lo, hi: cfg.hi ?? hi, scale: 2, caption: `${rule.name} t=${t}` });
  }
}
