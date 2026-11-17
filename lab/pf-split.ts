// Phase-field Bubbles: cut a settled bubble in two (an erased stripe, phi and content to 0, as the Erase brush does) and
// watch whether the halves round up as two bubbles or merge back. Logs each blob's area and the total content.
//   node lab/run.mjs pf-split '{"r":30,"m":6,"gap":6}'
import * as R from '../src/rule';
import { makeLab, log, saveFrame, blobs } from './lab';
export default async function (cfg: { r: number; m: number; gap: number; settle?: number; after?: number[]; rule?: string; tag?: string; set?: Record<string, number> }) {
  const rule = (R as unknown as Record<string, typeof R.PF_BUBBLES>)[cfg.rule ?? 'PF_BUBBLES'];
  const N = 256, lab = await makeLab(rule, N, cfg.set ?? {});
  const S4 = lab.layout.S * 4, ix = (n: string) => lab.layout.reagents.indexOf(n);
  const P = ix(rule.reagents.includes('phi1') ? 'phi1' : 'phi'), M = ix(rule.reagents.includes('m1') ? 'm1' : 'm');
  let { state } = await lab.read();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (Math.hypot(x - 128, y - 128) <= cfg.r) { const i = (y * N + x) * S4; state[i + P] = 1; state[i + M] = cfg.m; }
  lab.sim.writeRegion(0, 0, N, N, undefined, state);
  await lab.run(cfg.settle ?? 15000);
  const count = (s: Float32Array) => {
    let mt = 0;
    for (let i = 0; i < N * N; i++) mt += s[i * S4 + M];
    return `${blobs(s, N, lab.layout.S, P, 0.5, 4).map((b) => b.area).join(' ')}  content ${mt.toFixed(0)}`;
  };
  state = (await lab.read()).state;
  log(`settled: areas ${count(state)}`);
  // the cut: every reagent back to rest in a vertical stripe through the middle
  for (let y = 0; y < N; y++) for (let x = 128 - cfg.gap / 2; x < 128 + cfg.gap / 2; x++) for (let k = 0; k < lab.layout.S * 4; k++) state[(y * N + x) * S4 + k] = 0;
  lab.sim.writeRegion(0, 0, N, N, undefined, state);
  let t = 0;
  for (const T of cfg.after ?? [500, 2000, 10000, 30000]) {
    await lab.run(T - t); t = T;
    log(`${T} after the cut: areas ${count((await lab.read()).state)}`);
    if (cfg.tag) await saveFrame(`${cfg.tag}-${T}.png`, lab, { ri: P, lo: 0, hi: 1, scale: 1, caption: `${T} after cut` });
  }
}
