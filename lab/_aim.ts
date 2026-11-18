import * as R from '../src/rule';
import { makeLab, log, saveFrame } from './lab';
import { blobs } from './_mb';
const circle = (chem: string, value: number, cx: number, cy: number, r: number): R.Overlay => ({ chem, op: 'overwrite', fill: { type: 'constant', value }, shape: { type: 'circle', cx, cy, r } });
const rect = (chem: string, value: number, x0: number, y0: number, x1: number, y1: number): R.Overlay => ({ chem, op: 'overwrite', fill: { type: 'constant', value }, shape: { type: 'rectangle', x0, y0, x1, y1 } });
export default async function (cfg: { set?: Record<string, number>; at: number[]; name: string; v?: number }) {
  const W = 256, base = R.BUILTIN_RULES[47], v = cfg.v ?? 0.06;
  // a dot heading right along the middle; an aim region (pointing down the screen: ay -1) ahead of it
  const init: R.Overlay[] = [base.initial[0], circle('phi', 1, 0.15, 0.5, 0.04), circle('m', 10, 0.15, 0.5, 0.04), circle('px', 10 * v, 0.15, 0.5, 0.04),
    rect('ay', -1, 0.45, 0.35, 0.65, 0.65)];
  const lab = await makeLab({ ...base, initial: init }, W, cfg.set ?? {}, 'initial');
  const S4 = lab.layout.S * 4, ix = (r: string) => lab.layout.reagents.indexOf(r);
  let t = 0;
  for (const T of cfg.at) {
    await lab.run(T - t); t = T;
    const { state } = await lab.read();
    log(`${cfg.name} t=${T} ` + blobs(state, S4, W, W, ix).map((o) => `(${o.x.toFixed(0)},${o.y.toFixed(0)} A${o.area} p${o.px.toFixed(0)},${o.py.toFixed(0)} heading ${(Math.atan2(o.py, o.px) * 180 / Math.PI).toFixed(0)}°)`).join(' '));
    await saveFrame(`${cfg.name}-${T}.png`, lab, { ri: ix('phi'), lo: 0, hi: 1, ti: ix('ay'), tlo: -1, thi: 0, scale: 1, caption: `${cfg.name} t=${T}` });
  }
}
