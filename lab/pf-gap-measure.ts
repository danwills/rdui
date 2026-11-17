// Phase-field Bubbles 3: how far the blur h rises above phi at a lone edge, and in gaps of given widths between two flat
// edges (drain off), to set gap_margin between them. Logs the max of h - phi in each.
//   node lab/run.mjs pf-gap-measure '{"gaps":[4,6,8,12]}'
import * as R from '../src/rule';
import { makeLab, log } from './lab';
export default async function (cfg: { gaps: number[]; set?: Record<string, number> }) {
  const N = 128;
  for (const gap of [0, ...cfg.gaps]) {
    const lab = await makeLab(R.PF_BUBBLES_3, N, { drain: 0, pressure: 0, ...cfg.set });
    const S4 = lab.layout.S * 4, { state } = await lab.read();
    // a slab of phi (lone: one slab, its two edges far apart; gap: two slabs with a gap between)
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const inside = gap ? (x >= 20 && x < 64 - gap / 2) || (x >= 64 + gap / 2 && x < 108) : x >= 32 && x < 96;
      if (inside) { const i = (y * N + x) * S4; state[i] = 1; state[i + 2] = 1; }
    }
    lab.sim.writeRegion(0, 0, N, N, undefined, state);
    await lab.run(400);
    const s = (await lab.read()).state;
    let best = 0, at = 0;
    for (let x = 0; x < N; x++) { const i = (64 * N + x) * S4, d = s[i + 2] - s[i]; if (d > best) { best = d; at = x; } }
    const mid = s[(64 * N + 64) * S4];
    log(Array.from({ length: 32 }, (_, k) => s[(64 * N + 4 * k) * S4].toFixed(1)).join(" "));
    log(`${gap ? `gap ${gap}` : 'lone edges'}: max h - phi ${best.toFixed(3)} at x ${at}${gap ? `, phi at the gap's middle ${mid.toFixed(2)}` : ''}`);
  }
}
