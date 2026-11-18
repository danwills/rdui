import * as R from '../src/rule';
import { makeLab, log, saveFrame } from './lab';
const circle = (chem: string, value: number, cx: number, cy: number, r: number): R.Overlay => ({ chem, op: 'overwrite', fill: { type: 'constant', value }, shape: { type: 'circle', cx, cy, r } });
export default async function () {
  const W = 256, base = R.BUILTIN_RULES[48];
  const init = [base.initial[0], circle('phi', 1, 0.2, 0.5, 0.04), circle('m', 10, 0.2, 0.5, 0.04), circle('px', 0.6, 0.2, 0.5, 0.04), circle('s', 0.6, 0.2, 0.5, 0.04)];
  const lab = await makeLab({ ...base, initial: init }, W, {}, 'initial');
  const S4 = lab.layout.S * 4, ix = (r: string) => lab.layout.reagents.indexOf(r);
  let t = 0;
  for (const T of [500, 1500, 3000]) {
    await lab.run(T - t); t = T;
    const { state } = await lab.read();
    let tot = 0, inB = 0, edge = 0, sea = 0, neg = 0, cx = 0, n = 0;
    for (let i = 0; i < W * W; i++) { const ph = state[i * S4 + ix('phi')]; if (ph > 0.5) { cx += i % W; n++; } }
    cx /= n;
    // sea content by distance behind the bubble's centre (x), along its row band
    const behind = new Array(8).fill(0);
    for (let i = 0; i < W * W; i++) {
      const m = state[i * S4 + ix('m')], ph = state[i * S4 + ix('phi')];
      tot += m; if (m < 0) neg += m;
      if (ph > 0.5) inB += m; else if (ph > 0.05) edge += m; else { sea += m; let d = cx - (i % W); if (d < 0) d += W; behind[Math.min(7, Math.floor(d / 32))] += m; }
    }
    log(`t=${T} total ${tot.toFixed(0)} inside ${inB.toFixed(0)} edge ${edge.toFixed(0)} sea ${sea.toFixed(0)} (negative ${neg.toFixed(1)}) · sea behind by 32px bands ${behind.map((b) => b.toFixed(0)).join(' ')}`);
    await saveFrame(`wake-${T}.png`, lab, { ri: ix('m'), lo: 0, hi: 0.2, scale: 1, caption: `m (0-0.2) t=${T}` });
  }
}
