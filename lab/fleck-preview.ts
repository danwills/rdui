// Preview the fleck palettes (HSV and OKLCH of a, b, c) on a built-in rule's
// initial pattern after some steps, beside the rule's usual view.
import { BUILTIN_RULES } from '../src/rule';
import { makeLab, runAll, saveFrame } from './lab';

export default async function (cfg: { rule?: number; N?: number; steps?: number; shape?: number; offset?: number; g?: Record<string, number> }) {
  const rule = BUILTIN_RULES[cfg.rule ?? 1], N = cfg.N ?? 256;
  const lab = await makeLab(rule, N, cfg.g ?? {}, 'initial');
  await runAll([lab], cfg.steps ?? 6000);
  const ri = rule.reagents.indexOf(rule.view.reagent);
  await saveFrame('plain.png', lab, { ri, lo: rule.view.low, hi: rule.view.high, caption: `${rule.name} (usual view)` });
  for (const f of ['hsv', 'oklch'] as const) {
    await saveFrame(`${f}.png`, lab, { ri, lo: 0, hi: 1, fleck: f, hueShape: cfg.shape ?? 1, hueOffset: cfg.offset ?? 0, caption: `${f} fleck` });
  }
  lab.sim.destroy();
}
