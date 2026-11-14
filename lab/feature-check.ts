// Feature size (Simulation.setCellScale): a rule run at several grid spacings,
// checking it stays finite and active; frames of b.
import { BUILTIN_RULES } from '../src/rule';
import { makeLab, runAll, saveFrame, log } from './lab';

export default async function (cfg: { rule?: number; N?: number; sizes?: number[]; steps?: number; g?: Record<string, number> }) {
  const rule = BUILTIN_RULES[cfg.rule ?? 9], N = cfg.N ?? 256;
  for (const f of cfg.sizes ?? [0.5, 1, 2, 4]) {
    const lab = await makeLab(rule, N, cfg.g ?? {}, 'initial');
    lab.sim.setCellScale(1 / f);
    await runAll([lab], cfg.steps ?? 4000);
    const { state } = await lab.read(), S4 = lab.layout.S * 4;
    let hi = 0, nan = 0;
    for (let i = 1; i < state.length; i += S4) { if (!Number.isFinite(state[i])) nan++; else if (state[i] > 0.2) hi++; }
    log(`${rule.name} feature ${f}: active ${((hi / N / N) * 100).toFixed(1)}%${nan ? ` NaN ${nan}` : ''}`);
    await saveFrame(`feat${f}.png`, lab, { ri: 1, lo: 0, hi: 0.4, scale: 1, caption: `feature ${f}` });
    lab.sim.destroy();
  }
}
