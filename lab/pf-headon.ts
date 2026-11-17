// Two bubbles head-on: a warm one rising from below a cool one sinking, on the same line (no heating or leak, so their
// temperatures hold). Logs both centres: do they slip past each other (swap order, moving sideways) or jam?
//   node lab/run.mjs pf-headon '{"rule":"PF_BUBBLES_10"}'
import * as R from '../src/rule';
import { makeLab, log, saveFrame, blobs } from './lab';
export default async function (cfg: { rule: string; T?: number; r?: number; set?: Record<string, number>; steps?: number; every?: number; tag?: string }) {
  const rule = (R as unknown as Record<string, typeof R.PF_BUBBLES_10>)[cfg.rule];
  const N = 256, r = cfg.r ?? 22, T = cfg.T ?? 1;
  const lab = await makeLab(rule, N, { heat: 0, T_leak: 0, buoy: 0.018, ...cfg.set });
  const S4 = lab.layout.S * 4, ix = (n: string) => lab.layout.reagents.indexOf(n), { state } = await lab.read();
  // (x a hair off centre for the lower one, as nothing in nature lines up exactly)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * S4; state[i + ix('u')] = 1;
    // (with a sway, version 11: phases a quarter turn apart)
    for (const [cx, cy, temp, ph] of [[128.5, 180, T, 0], [128, 76, -T, Math.PI / 2]]) if (Math.hypot(x - cx, y - cy) <= r) {
      state[i + ix('phi')] = 1; state[i + ix('m')] = 6; state[i + ix('T')] = temp;
      if (ix('vx') >= 0) { state[i + ix('vx')] = Math.cos(ph); state[i + ix('vw')] = Math.sin(ph); }
    }
  }
  lab.sim.writeRegion(0, 0, N, N, undefined, state);
  for (let t = 0; t < (cfg.steps ?? 400000); ) {
    const dt = cfg.every ?? 50000; await lab.run(dt); t += dt;
    const s = (await lab.read()).state;
    const bs = blobs(s, N, lab.layout.S, ix('phi'), 0.5, 20).map((b) => {
      const temp = s[(Math.round(b.y) * N + Math.round(b.x)) * S4 + ix('T')];
      return `${temp > 0 ? 'warm' : 'cool'} (${b.x.toFixed(0)}, ${b.y.toFixed(0)}) area ${b.area}`;
    });
    log(`t=${t}: ${bs.join(' | ')}`);
    if (cfg.tag) await saveFrame(`${cfg.tag}-${t}.png`, lab, { ri: ix('phi'), lo: 0, hi: 1, ti: ix('T'), tlo: -1, thi: 1, scale: 1, caption: `t=${t}` });
  }
}
