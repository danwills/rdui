// node lab/run.mjs fluid-push
// The Push tool on the fluids. Stable fluids (Stir): a still fluid, a dye blob, a drag rightwards through it, cut into
// 1 or 24 segments (the shove should be about the same): the dye's centroid should go right, no dye added, net spin 0.
// Schrödinger's Smoke (Pair): a uniform ψ1, a little ψ2, one launched pair heading right: its cores should go right.
import * as R from '../src/rule';
import { BrushMode } from '../src/sim';
import { makeLab, saveFrame, log } from './lab';

export default async function () {
  const N = 256;
  for (const segs of [1, 24]) {
    const l = await makeLab(R.STABLE_FLUIDS, N);
    const S4 = l.layout.S * 4, iw = l.layout.reagents.indexOf('omega'), id = l.layout.reagents.indexOf('dye');
    const { state } = await l.read();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) state[(y * N + x) * S4 + id] = Math.hypot(x - 100, y - 128) < 12 ? 1 : 0;
    l.sim.writeRegion(0, 0, N, N, undefined, state);
    for (let k = 0; k < segs; k++) {
      const ax = 70 + (60 * k) / segs, bx = 70 + (60 * (k + 1)) / segs;
      l.sim.brush({ ax, ay: 128, bx, by: 128, radius: 12, mode: BrushMode.Stir, strength: 1, hardness: 0.5, paint: [] });
    }
    const stats = async (t: string) => {
      const { state: s } = await l.read();
      let dye = 0, mx = 0, w = 0, wmax = 0;
      for (let c = 0; c < N * N; c++) { dye += s[c * S4 + id]; mx += s[c * S4 + id] * (c % N); w += s[c * S4 + iw]; wmax = Math.max(wmax, Math.abs(s[c * S4 + iw])); }
      log(`stir ${segs} segs ${t}: dye ${dye.toFixed(1)} at x ${(mx / dye).toFixed(1)}, net ω ${w.toFixed(4)}, max |ω| ${wmax.toFixed(3)}`);
    };
    await stats('0');
    for (const n of [100, 300]) { await l.run(n); await stats(`+${n}`); }
    await saveFrame(`stir-${segs}.png`, l, { ri: id, lo: 0, hi: 1, scale: 2, caption: `${segs} segs` });
  }

  const l = await makeLab(R.SCHRODINGER_SMOKE, N);
  const S4 = l.layout.S * 4, ia2 = l.layout.reagents.indexOf('a2'), ic = l.layout.reagents.indexOf('core');
  const { state } = await l.read();
  for (let c = 0; c < N * N; c++) state[c * S4 + ia2] = 0.2;
  l.sim.writeRegion(0, 0, N, N, undefined, state);
  l.sim.brush({ ax: 128, ay: 128, bx: 140, by: 128, radius: 10, mode: BrushMode.Pair, strength: 1, hardness: 0.5, paint: [] });
  for (const n of [0, 150, 300, 600]) {
    if (n) await l.run(n - (n === 150 ? 0 : n / 2));
    const { state: s } = await l.read();
    // the cores: cells mostly ψ2, split into above and below the centre row
    const at = [[0, 0, 0], [0, 0, 0]];
    for (let c = 0; c < N * N; c++) { const v = s[c * S4 + ic]; if (v > 0.3) { const k = Math.floor(c / N) < 128 ? 0 : 1; at[k][0] += v; at[k][1] += v * (c % N); at[k][2] += v * Math.floor(c / N); } }
    log(`pair step ${n}: ${at.map(([m, x, y]) => (m ? `(${(x / m).toFixed(1)}, ${(y / m).toFixed(1)}) w ${m.toFixed(1)}` : 'none')).join('  ')}`);
  }
  await saveFrame('pair.png', l, { ri: ic, lo: 0, hi: 1, scale: 2, caption: 'cores' });
}
