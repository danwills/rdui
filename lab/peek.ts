// Run a built-in rule (by name fragment) from its initial state with optional
// global overrides; log each reagent's range and the blob count, and save
// frames (for lab/mp4.sh).
import * as R from '../src/rule';
import { makeLab, blobs, saveFrame, log } from './lab';

export default async function (cfg: { rule: string; g?: Record<string, number>; N?: number; steps?: number; every?: number; view?: string; lo?: number; hi?: number; tint?: string; spectral?: boolean; thr?: number }) {
  const base = R.BUILTIN_RULES.find((r) => r.name.toLowerCase().includes(cfg.rule.toLowerCase()))!;
  const rule = cfg.spectral ? { ...base, laplacian: 'spectral' as const } : base;
  const N = cfg.N ?? 256, lab = await makeLab(rule, N, cfg.g ?? {}, 'initial');
  const v = rule.reagents.indexOf(cfg.view ?? rule.view.reagent), ti = cfg.tint ?? rule.view.tint;
  let f = 0;
  for (let t = 0; t <= (cfg.steps ?? 20000); t += cfg.every ?? 1000) {
    if (t) await lab.run(cfg.every ?? 1000);
    const { state } = await lab.read(), S4 = lab.layout.S * 4;
    const rng = rule.reagents.map((r, k) => {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < N * N; i++) { const x = state[i * S4 + k]; if (x < lo) lo = x; if (x > hi) hi = x; }
      return `${r} ${lo.toFixed(3)}…${hi.toFixed(3)}`;
    });
    const nb = blobs(state, N, lab.layout.S, v, cfg.thr ?? (rule.view.low + rule.view.high) / 2).length;
    log(`t=${t}: ${rng.join('  ')}  blobs(${rule.reagents[v]}) ${nb}`);
    await saveFrame(`f${String(f++).padStart(4, '0')}.png`, lab, { ri: v, lo: cfg.lo ?? rule.view.low, hi: cfg.hi ?? rule.view.high, ti: ti ? rule.reagents.indexOf(ti) : undefined, tlo: 0, thi: 1, scale: 2, caption: `${rule.name}  t=${t}` });
  }
  lab.sim.destroy();
}
