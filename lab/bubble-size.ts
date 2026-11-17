// Gray-Scott Bubbles: does a bubble settle at the size its content sets? Seeds disks (radius r, content
// m per cell; expected settled radius r·√(m/target)) and logs each one's ring radius (b-weighted mean
// distance from its seed point, b > 0.15, within `reach`), its roundness, and the total content (held in?).
//   node lab/run.mjs bubble-size '{"bubbles":[[128,128,16,4]]}'
import * as R from '../src/rule';
import { makeLab, log, saveFrame } from './lab';

export default async function (cfg: { bubbles: [number, number, number, number][]; N?: number; steps?: number; every?: number; set?: Record<string, number>; tag?: string; reach?: number; core?: number }) {
  const N = cfg.N ?? 256;
  const lab = await makeLab(R.GS_BUBBLES, N, cfg.set ?? {});
  const S4 = lab.layout.S * 4, { state } = await lab.read();
  for (const [cx, cy, r, m] of cfg.bubbles) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (Math.hypot(x - cx, y - cy) <= r) {
    const i = (y * N + x) * S4; state[i] = 0.5; state[i + 1] = 0.25; if (Math.hypot(x - cx, y - cy) <= r - (cfg.core ?? 0)) state[i + 2] = m;
  }
  lab.sim.writeRegion(0, 0, N, N, undefined, state);
  const reach = cfg.reach ?? 90;
  for (let t = 0; t < (cfg.steps ?? 60000); ) {
    const dt = cfg.every ?? 10000;
    await lab.run(dt); t += dt;
    const s = (await lab.read()).state;
    let mt = 0;
    for (let i = 0; i < N * N; i++) mt += s[i * S4 + 2];
    const each = cfg.bubbles.map(([cx, cy, r, m]) => {
      let w = 0, a = 0, a2 = 0;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const d = Math.hypot(x - cx, y - cy); if (d > reach) continue;
        const b = s[(y * N + x) * S4 + 1]; if (b > 0.15) { w += b; a += b * d; a2 += b * d * d; }
      }
      const mr = a / w;
      return w ? `r ${mr.toFixed(1)}±${Math.sqrt(Math.max(0, a2 / w - mr * mr)).toFixed(1)} (expect ${(r * Math.sqrt(m / (cfg.set?.target ?? 1))).toFixed(0)}) m ${s[((cy | 0) * N + (cx | 0)) * S4 + 2].toFixed(2)}` : 'gone';
    });
    log(`${t / 1000}k: ${each.join(' | ')}  total m ${mt.toFixed(0)}`);
    if (cfg.tag) await saveFrame(`${cfg.tag}-${String(t).padStart(6, '0')}.png`, lab, { ri: 1, lo: 0, hi: 0.4, scale: 1, caption: `t=${t}` });
  }
}
