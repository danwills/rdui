// Phase-field Bubbles 6+: one bubble with a fixed, uniform temperature (no heating or leak), moving by buoyancy alone; logs
// its centre, size, elongation and content, to see whether its shape holds as it moves.
//   node lab/run.mjs pf-move '{"T":1,"r":20,"m":6}'
import * as R from '../src/rule';
import { makeLab, log, saveFrame } from './lab';
export default async function (cfg: { T: number; r: number; m: number; rule?: string; set?: Record<string, number>; every?: number; steps?: number; tag?: string }) {
  const rule = (R as unknown as Record<string, typeof R.PF_BUBBLES_6>)[cfg.rule ?? 'PF_BUBBLES_6'];
  const N = 256, lab = await makeLab(rule, N, { heat: 0, T_leak: 0, ...cfg.set });
  const S4 = lab.layout.S * 4, ix = (n: string) => lab.layout.reagents.indexOf(n), { state } = await lab.read();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * S4; state[i + ix('u')] = 1;
    if (Math.hypot(x - 128, y - 200) <= cfg.r) { state[i + ix('phi')] = 1; state[i + ix('m')] = cfg.m; state[i + ix('T')] = cfg.T; }
  }
  lab.sim.writeRegion(0, 0, N, N, undefined, state);
  for (let t = 0; t < (cfg.steps ?? 20000); ) {
    const dt = cfg.every ?? 4000; await lab.run(dt); t += dt;
    const s = (await lab.read()).state;
    let a = 0, sx = 0, sy = 0, sxx = 0, syy = 0, mt = 0, Tt = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = (y * N + x) * S4; mt += s[i + ix('m')];
      if (s[i + ix('phi')] > 0.5) { a++; sx += x; sy += y; sxx += x * x; syy += y * y; Tt += s[i + ix('T')]; }
    }
    const cx = sx / a, cy = sy / a, wx = Math.sqrt(sxx / a - cx * cx), wy = Math.sqrt(syy / a - cy * cy);
    log(`t=${t}: centre (${cx.toFixed(0)}, ${cy.toFixed(0)}) area ${a} width/height ${(wx / wy).toFixed(2)} T ${(Tt / a).toFixed(2)} content ${mt.toFixed(0)}`);
    if (cfg.tag) await saveFrame(`${cfg.tag}-${t}.png`, lab, { ri: ix('phi'), lo: 0, hi: 1, ti: ix('T'), tlo: -1, thi: 1, scale: 1, caption: `t=${t}` });
  }
}
