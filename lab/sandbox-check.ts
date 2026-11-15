// Fire a soliton stamp at a sandbox scene's edge and track it: does the edge absorb or reflect it?
import * as R from '../src/rule';
import { STARTER_STAMPS } from '../src/stamps';
import { makeLab, log } from './lab';
import type { Scene } from '../src/scenes';

export default async function (cfg: { scene: string; stamp: string; checks: number[] }) {
  const sc: Scene = await (await fetch(`/scenes/${cfg.scene}.json`)).json();
  const lab = await makeLab({ ...R.BUILTIN_RULES[+sc.rule.split(':')[1]], initial: sc.initial! }, 256, sc.globals ?? {}, 'initial');
  await lab.place(STARTER_STAMPS.find((s) => s.id === cfg.stamp)!, 128, 128);
  const N = lab.N, S4 = lab.layout.S * 4;
  let t = 0;
  for (const c of cfg.checks) {
    if (c > t) { await lab.run(c - t); t = c; }
    const { state } = await lab.read();
    let m = 0, mx = 0, peak = 0;
    for (let i = 0; i < N * N; i++) { const I = state[i * S4] ** 2 + state[i * S4 + 1] ** 2; m += I; mx += I * (i % N); peak = Math.max(peak, I); }
    log(`t=${t}: power ${m.toFixed(0)}, peak ${peak.toFixed(2)}, mean x ${(mx / m).toFixed(1)}`);
  }
}
