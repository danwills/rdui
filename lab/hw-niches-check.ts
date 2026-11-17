// Runs a GS History+Wave Niches scene (or a scene given as json) and logs each species' live cells and how much is moving (live
// cells that were not live 300 steps before) at the given steps; saves the last frame (history c tinted by P_F).
import * as R from '../src/rule';
import type { Scene } from '../src/scenes';
import { makeLab, log, saveFrame } from './lab';
export default async function (cfg: { scene: string; set?: Record<string, number>; tag?: string; at?: number[]; json?: Scene; tlo?: number }) {
  const sc: Scene = cfg.json ?? await (await fetch(`/scenes/${cfg.scene}.json`)).json();
  const lab = await makeLab({ ...R.GS_HW_NICHES, initial: sc.initial! }, sc.size!, { ...sc.globals, ...cfg.set }, 'initial');
  const S4 = lab.layout.S * 4, N = lab.N, ix = (n: string) => lab.layout.reagents.indexOf(n);
  let prev = 0;
  for (const t of cfg.at ?? [5000, 20000, 40000, 80000]) {
    await lab.run(t - prev - 300);
    const before = (await lab.read()).state;
    await lab.run(300);
    prev = t;
    const { state } = await lab.read();
    let lv = 0, fresh = 0;
    for (let i = 0; i < N * N; i++) { let b = 0, b0 = 0; for (let j = 0; j < 4; j++) { b += state[i * S4 + 4 + j]; b0 += before[i * S4 + 4 + j]; } if (b > 0.1) { lv++; if (b0 <= 0.1) fresh++; } }
    const live = [0, 0, 0, 0];
    for (let i = 0; i < N * N; i++) for (let j = 0; j < 4; j++) if (state[i * S4 + ix(`b${j + 1}`)] > 0.1) live[j]++;
    log(`t=${t}: live cells b1..b4 ${live.join(' ')}  moving ${lv ? (100 * fresh / lv).toFixed(0) : '-'}%`);
  }
  await saveFrame(`${cfg.tag ?? 'circles'}.png`, lab, { ri: ix('c'), lo: 0, hi: 1, ti: ix('P_F'), tlo: cfg.tlo ?? 0.03, thi: 0.072, scale: 1 });
}
