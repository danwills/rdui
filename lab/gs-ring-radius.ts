// A Gray-Scott ring bubble's size over time: a disk of radius r stamped at the centre; logs the ring's mean
// radius (b-weighted, b > 0.15) and how round it is (spread of the radius), every `every` steps.
//   node lab/run.mjs gs-ring-radius '{"F":0.058,"k":0.0645,"r":[12,24,40]}'
import * as R from '../src/rule';
import { makeLab, log } from './lab';

export default async function (cfg: { F: number; k: number; r: number[]; N?: number; steps?: number; every?: number; ring?: boolean; kGrow?: number; grow?: number }) {
  const N = cfg.N ?? 256, c = N / 2;
  for (const r of cfg.r) {
    const lab = await makeLab(R.GRAY_SCOTT, N, { F: cfg.F, k: cfg.k });
    const S4 = lab.layout.S * 4, { state } = await lab.read();
    // a disk, or (ring) just the membrane: an annulus 6 cells wide at radius r
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const d = Math.hypot(x - c, y - c); if (cfg.ring ? Math.abs(d - r) <= 3 : d <= r) { const i = (y * N + x) * S4; state[i] = 0.5; state[i + 1] = 0.25; } }
    lab.sim.writeRegion(0, 0, N, N, undefined, state);
    const out: string[] = [];
    // grown first at kGrow (a disk hollows into a ring there), then switched to k
    if (cfg.kGrow !== undefined) {
      lab.sim.setGlobal('k', cfg.kGrow);
      await lab.run(cfg.grow ?? 10000);
      lab.sim.setGlobal('k', cfg.k);
    }
    for (let t = 0; t < (cfg.steps ?? 80000); ) {
      const dt = cfg.every ?? 10000;
      await lab.run(dt); t += dt;
      const s = (await lab.read()).state;
      let w = 0, m = 0, m2 = 0, inside = 0;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const b = s[(y * N + x) * S4 + 1];
        if (b > 0.15) { const d = Math.hypot(x - c, y - c); w += b; m += b * d; m2 += b * d * d; }
      }
      const mr = m / w, sd = Math.sqrt(Math.max(0, m2 / w - mr * mr));
      // is the middle still empty (a bubble) or filled
      inside = s[(c * N + c) * S4 + 1];
      out.push(w ? `${t / 1000}k r ${mr.toFixed(1)}±${sd.toFixed(1)}${inside > 0.15 ? ' (filled)' : ''}` : `${t / 1000}k gone`);
    }
    log(`F ${cfg.F} k ${cfg.k} stamp r ${r}: ${out.join('  ')}`);
    lab.sim.destroy();
  }
}
