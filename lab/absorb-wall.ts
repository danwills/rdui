// How well does a Wall-tool stroke of damping (gamma graded by the brush falloff) absorb a soliton?
// Draws a vertical stroke on a plain (wrapping) field at x = 160, fires a soliton east at it, and reports the
// power that bounced back and that got through (both 0 = a perfect absorber). set: globals (e.g. wall_grow).
import * as R from '../src/rule';
import { BrushMode } from '../src/sim';
import { STARTER_STAMPS } from '../src/stamps';
import { makeLab, log } from './lab';

export default async function (cfg: { radii: number[]; stamps?: string[]; reflect?: boolean; set?: Record<string, number> }) {
  for (const id of cfg.stamps ?? ['nls-soliton-0-slow', 'nls-soliton-0-fast']) for (const r of cfg.radii) {
    const lab = await makeLab(R.BUILTIN_RULES[8], 256);
    // as the Wall tool draws them (main.ts toBrush): a stroke into the absorbing or (reflect) reflecting distance field
    const L = lab.layout, slot = L.paramNames.indexOf(cfg.reflect ? 'reflect_d' : 'absorb_d');
    lab.sim.brush({ ax: 160, ay: 40, bx: 160, by: 216, radius: r, mode: BrushMode.Sdf, strength: 1, hardness: 1, paint: L.paramNames.slice(1).map(() => -1e38), slot, clear: cfg.reflect, base: 1 });
    if (cfg.set) for (const [k, v] of Object.entries(cfg.set)) lab.sim.setGlobal(k, v);
    await lab.place(STARTER_STAMPS.find((s) => s.id === id)!, id.includes('fast') ? 60 : 100, 128);
    const N = lab.N, S4 = L.S * 4;
    // power before the wall (x < 160: bounced back) and past it
    const power = async () => { const { state } = await lab.read(); let back = 0, past = 0; for (let i = 0; i < N * N; i++) { const I = state[i * S4] ** 2 + state[i * S4 + 1] ** 2; if (i % N < 160) back += I; else past += I; } return [back, past]; };
    const [p0] = await power();
    await lab.run(id.includes('fast') ? 1300 : 3000);
    const [back, past] = await power();
    log(`${id} radius ${r}: bounced back ${((100 * back) / p0).toFixed(1)}%, let through ${((100 * past) / p0).toFixed(1)}%`);
  }
}
