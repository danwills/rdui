// Runs a builtin rule from its own initial state and saves frames of u (or show): node lab/run.mjs _ripples '{"rule":"RIPPLES","at":[200,800]}'
import * as R from '../src/rule';
import { makeLab, log, saveFrame } from './lab';
export default async function (cfg: { rule: string; at: number[]; set?: Record<string, number>; lo?: number; hi?: number; show?: string; tint?: string; also?: string[] }) {
  const base = (R as any)[cfg.rule] as R.RuleDef;
  const W = base.size?.width ?? 256;
  const lab = await makeLab(base, W, cfg.set ?? {}, 'initial');
  const S4 = lab.layout.S * 4, ui = lab.layout.reagents.indexOf(cfg.show ?? 'u'), vi = lab.layout.reagents.indexOf(cfg.tint ?? 'v');
  const hi = cfg.hi ?? base.view.high, lo = cfg.lo ?? base.view.low;
  let t = 0;
  for (const T of cfg.at) {
    await lab.run(T - t); t = T;
    const { state } = await lab.read();
    let umax = 0, umin = Infinity, umx = -Infinity, e = 0;
    for (let i = 0; i < W * W; i++) { const u = state[i * S4 + ui], v = vi >= 0 ? state[i * S4 + vi] : 0; umax = Math.max(umax, Math.abs(u)); umin = Math.min(umin, u); umx = Math.max(umx, u); e += v * v; }
    log(`t=${T} ${cfg.show ?? 'u'} ${umin.toFixed(3)}..${umx.toFixed(3)} sum ${cfg.tint ?? 'v'}² ${e.toFixed(2)}${Number.isFinite(umax) ? '' : ' (blew up)'}`);
    await saveFrame(`${cfg.rule}-${T}.png`, lab, { ri: ui, lo, hi, ti: vi, tlo: lo, thi: hi, scale: 1, caption: `${cfg.rule} t=${T}` });
    for (const r of cfg.also ?? []) await saveFrame(`${cfg.rule}-${r}-${T}.png`, lab, { ri: lab.layout.reagents.indexOf(r), lo, hi, scale: 1, caption: `${cfg.rule} ${r} t=${T}` });
  }
}
