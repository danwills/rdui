import * as R from '../src/rule';
import { makeLab, log, saveFrame } from './lab';
import { blobs } from './_mb';
const circle = (chem: string, value: number, cx: number, cy: number, r: number): R.Overlay => ({ chem, op: 'overwrite', fill: { type: 'constant', value }, shape: { type: 'circle', cx, cy, r } });
export default async function (cfg: { mb?: number; k: number; ro?: number; ri?: number; set?: Record<string, number>; at: number[]; name: string; dot?: number }) {
  const W = 256, ro = cfg.ro ?? 0.3, ri = cfg.ri ?? 0.27, base = R.BUILTIN_RULES[46];
  const init: R.Overlay[] = [base.initial[0], circle('B', 1, 0.5, 0.5, ro), circle('mb', cfg.mb ?? 4, 0.5, 0.5, ro), circle('B', 0, 0.5, 0.5, ri), circle('mb', 0, 0.5, 0.5, ri)];
  const k = cfg.k, sp = (2 * ri * 0.75) / k, dr = cfg.dot ?? 0.03;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    const cx = 0.5 + (i - (k - 1) / 2) * sp, cy = 0.5 + (j - (k - 1) / 2) * sp;
    init.push(circle('phi', 1, cx, cy, dr), circle('m', 10, cx, cy, dr));
  }
  const lab = await makeLab({ ...base, initial: init }, W, cfg.set ?? {}, 'initial');
  const S4 = lab.layout.S * 4, ix = (r: string) => lab.layout.reagents.indexOf(r);
  let t = 0;
  for (const T of cfg.at) {
    await lab.run(T - t); t = T;
    const { state } = await lab.read();
    // torn: the open (B < 0.5) region round the centre reaches the field's corner
    const seen = new Uint8Array(W * W), st = [(W / 2) * W + W / 2]; seen[st[0]] = 1; let torn = false;
    while (st.length) {
      const c = st.pop()!, x = c % W, y = (c / W) | 0;
      if (x === 0 || y === 0) { torn = true; break; }
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const q = (y + ay) * W + (x + ax);
        if (!seen[q] && state[q * S4 + ix('B')] < 0.5) { seen[q] = 1; st.push(q); }
      }
    }
    let bsum = 0; for (let i = 0; i < W * W; i++) { bsum += state[i * S4 + ix('mb')]; }
    const b = blobs(state, S4, W, W, ix);
    const inside = b.filter((o) => Math.hypot(o.x - W / 2, o.y - W / 2) < ri * W).length;
    let barea = 0; for (let i = 0; i < W * W; i++) if (state[i * S4 + ix('B')] > 0.5) barea++;
    log(`${cfg.name} t=${T} ${torn ? 'TORN' : 'whole'} bag area ${barea} content ${bsum.toFixed(0)} · bubbles ${b.length} (${inside} inside) areas ${b.map((o) => o.area).sort((p, q) => q - p).slice(0, 6).join(',')}`);
    await saveFrame(`${cfg.name}-${T}.png`, lab, { ri: ix('phi'), lo: 0, hi: 1, ti: ix('B'), tlo: 0, thi: 1, scale: 1, caption: `${cfg.name} t=${T}` });
  }
}
