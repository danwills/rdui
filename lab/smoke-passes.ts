// node lab/run.mjs smoke-passes '{"rule":"SCHRODINGER_SMOKE"}'
// Schrödinger's Smoke's passes (A 0, B 1, C 2) should go strictly in turn, whatever the timestep does: run a while at
// 2, a few steps at in-between values (a slider dragged), then at 8, and log the pass each step takes (as the rule
// picks it from its clock), flagging any step that isn't the one after the last.
import * as R from '../src/rule';
import { makeLab, log } from './lab';

export default async function (cfg: { rule?: string }) {
  const rule = (R as unknown as Record<string, R.RuleDef>)[cfg.rule ?? 'SCHRODINGER_SMOKE'];
  const l = await makeLab(rule, 64, {}, 'initial');
  const ic = l.layout.reagents.indexOf('clock');
  // the pass a step takes, from the clock it starts with: as the rule's formula has it
  const newPick = /fmod\(floor\(clock \+ 0\.5\)/.test(rule.formula);
  const pick = (clock: number, ts: number) => (newPick ? Math.floor(clock + 0.5) % 3 : Math.floor(Math.fround(clock / ts) + 0.5) % 3);
  let last = -1, bad = 0, steps = 0;
  const go = async (ts: number, n: number) => {
    l.sim.setGlobal('timestep', ts);
    for (let k = 0; k < n; k++) {
      const clock = (await l.sim.readRegion(0, 0, 1, 1)).state[ic];
      const p = pick(clock, ts);
      if (last >= 0 && p !== (last + 1) % 3) { bad++; if (bad <= 12) log(`step ${steps} (timestep ${ts}): pass ${p} after ${last} (clock ${clock})`); }
      last = p;
      await l.run(1);
      steps++;
    }
  };
  await go(2, 300);
  for (const ts of [2.13, 2.71, 3.4, 4.05, 5.5, 6.62, 7.3]) await go(ts, 1);
  await go(8, 600);
  log(`${rule.name}: ${bad} steps out of turn in ${steps} (${newPick ? 'pass counted' : 'pass from clock/timestep'})`);
}
