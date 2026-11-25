// Prints a built-in rule's reagents, params and whole formula (with every version's changes applied):
//   node lab/run.mjs print-rule '{"rule":"MOMENTUM_BUBBLES_18"}'
import * as R from '../src/rule';
import { log } from './lab';

export default async function (cfg: { rule: string }) {
  const r = (R as unknown as Record<string, R.RuleDef>)[cfg.rule];
  log(`reagents: ${r.reagents.join(' ')}`);
  log(`params: ${r.params.map((p) => `${p.name}=${p.value}`).join(' ')}`);
  log(`paintable: ${r.paintable.join(' ')}`);
  log(r.formula);
}
