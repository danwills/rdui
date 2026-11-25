// Runs a builtin rule from its own initial state and saves frames of u: node lab/run.mjs _ripples '{"rule":"RIPPLES","at":[200,800]}'
import * as R from '../src/rule';
import { makeLab, log, saveFrame } from './lab';
export default async function (cfg: { rule: string; at: number[]; set?: Record<string, number>; lo?: number; hi?: number }) {
  const base = (R as any)[cfg.rule] as R.RuleDef;
  const W = base.size?.width ?? 256;
  const lab = await makeLab(base, W, cfg.set ?? {}, 'initial');
  const S4 = lab.layout.S * 4, ui = lab.layout.reagents.indexOf('u'), vi = lab.layout.reagents.indexOf('v');
  const hi = cfg.hi ?? base.view.high, lo = cfg.lo ?? base.view.low;
  let t = 0;
  for (const T of cfg.at) {
    await lab.run(T - t); t = T;
    const { state } = await lab.read();
    let umax = 0, e = 0;
    for (let i = 0; i < W * W; i++) { const u = state[i * S4 + ui], v = state[i * S4 + vi]; umax = Math.max(umax, Math.abs(u)); e += v * v; }
    log(`t=${T} |u| max ${umax.toFixed(4)} sum v² ${e.toFixed(2)}${Number.isFinite(umax) ? '' : ' (blew up)'}`);
    await saveFrame(`${cfg.rule}-${T}.png`, lab, { ri: ui, lo, hi, ti: vi, tlo: lo, thi: hi, scale: 1, caption: `${cfg.rule} t=${T}` });
  }
}
