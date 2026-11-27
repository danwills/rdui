// node lab/run.mjs sand-doze
// Push (Doze) on sand: a drag through flat sand should move it, mass kept: total sand the same, a trench behind,
// a berm piled up ahead, nothing NaN. On Sand dunes (H, with the ripples r carried too) and Sand ripples (h).
import * as R from '../src/rule';
import { BrushMode } from '../src/sim';
import { makeLab, saveFrame, log } from './lab';

export default async function () {
  for (const [name, rule, hName] of [['dunes', R.SAND_DUNES, 'H'], ['ripples', R.SAND_RIPPLES, 'h']] as const) {
    const N = 256, l = await makeLab(rule, N, {}, 'initial');
    const S4 = l.layout.S * 4, ih = l.layout.reagents.indexOf(hName);
    const sum = async () => {
      const { state: s } = await l.read();
      let t = 0, nan = 0, lo = Infinity, hi = -Infinity;
      for (let c = 0; c < N * N; c++) { const v = s[c * S4 + ih]; if (!Number.isFinite(v)) { nan++; continue; } t += v; lo = Math.min(lo, v); hi = Math.max(hi, v); }
      // along the drag's line: the height behind, at and ahead of where it ended
      const at = (x: number) => s[(128 * N + x) * S4 + ih];
      return { t, nan, lo, hi, line: [80, 110, 150, 175, 185].map((x) => at(x).toFixed(2)).join(' ') };
    };
    const before = await sum();
    // a drag east along y 128 from x 60 to 160, in 4-cell pieces as a finger's
    for (let x = 60; x < 160; x += 4) l.sim.brushAll([{ ax: x, ay: 128, bx: x + 4, by: 128, radius: 16, mode: BrushMode.Doze, strength: 1, hardness: 0.5, paint: [] }]);
    const after = await sum();
    log(`${name}: sand ${before.t.toFixed(1)} → ${after.t.toFixed(1)}, range ${after.lo.toFixed(2)}…${after.hi.toFixed(2)}, NaN ${after.nan}; along the line (x 80 110 150 175 185) ${before.line} → ${after.line}`);
    await saveFrame(`doze-${name}.png`, l, { ri: ih, lo: before.lo - 2, hi: before.hi + 6, scale: 2, caption: `${name} after a doze` });
  }
}
