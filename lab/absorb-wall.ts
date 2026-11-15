// How well does a Wall-tool stroke of damping (gamma graded by the brush falloff) absorb a soliton?
// Draws a vertical stroke on a plain (wrapping) field at x = 200, fires a soliton east at it, and reports the
// power left once it has passed: whatever the stroke didn't soak up, reflected or let through (0 = perfect absorber).
import * as R from '../src/rule';
import { BrushMode } from '../src/sim';
import { STARTER_STAMPS } from '../src/stamps';
import { makeLab, log } from './lab';

export default async function (cfg: { radii: number[]; gamma?: number; stamps?: string[] }) {
  for (const id of cfg.stamps ?? ['nls-soliton-0-slow', 'nls-soliton-0-fast']) for (const r of cfg.radii) {
    const lab = await makeLab(R.BUILTIN_RULES[8], 256);
    const L = lab.layout, slot = L.paramNames.indexOf('gamma'), paint = L.paramNames.slice(1).map(() => 0);
    paint[slot - 1] = cfg.gamma ?? 0.3;
    lab.sim.brush({ ax: 200, ay: 40, bx: 200, by: 216, radius: r, mode: BrushMode.SetParam, strength: 1, hardness: 0, paint, slot });
    await lab.place(STARTER_STAMPS.find((s) => s.id === id)!, 120, 128);
    const N = lab.N, S4 = L.S * 4;
    const power = async () => { const { state } = await lab.read(); let m = 0; for (let i = 0; i < N * N; i++) m += state[i * S4] ** 2 + state[i * S4 + 1] ** 2; return m; };
    const p0 = await power();
    await lab.run(id.includes('fast') ? 1500 : 4000);
    log(`${id} radius ${r}: power kept ${((100 * (await power())) / p0).toFixed(1)}%`);
  }
}
