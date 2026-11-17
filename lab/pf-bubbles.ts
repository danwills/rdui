// Phase-field Bubbles: does a bubble settle at a size its content sets, stay round, and dock with a neighbour without
// merging? Stamps disks (cx, cy, r, m, kind 0-2: phi 1, content m) and logs each one's radius (from its phi area within reach of its
// centre: sqrt(area/pi)), roundness (spread of the edge's distance from its centroid) and content (total m held), and the
// number of separate bubbles; saves frames.
//   node lab/run.mjs pf-bubbles '{"bubbles":[[128,128,16,3]]}'
import * as R from '../src/rule';
import { makeLab, log, saveFrame, blobs } from './lab';

export default async function (cfg: { bubbles: [number, number, number, number, number?][]; N?: number; steps?: number; every?: number; set?: Record<string, number>; tag?: string; reach?: number }) {
  const N = cfg.N ?? 256;
  const lab = await makeLab(R.PF_BUBBLES, N, cfg.set ?? {});
  const S4 = lab.layout.S * 4, { state } = await lab.read();
  // (kind: 0-2, phase phi1-3 and its content m1-3)
  const ix = (n: string) => lab.layout.reagents.indexOf(n);
  for (const [cx, cy, r, m, k = 0] of cfg.bubbles) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (Math.hypot(x - cx, y - cy) <= r) {
    const i = (y * N + x) * S4; state[i + ix(`phi${k + 1}`)] = 1; state[i + ix(`m${k + 1}`)] = m;
  }
  lab.sim.writeRegion(0, 0, N, N, undefined, state);
  const reach = cfg.reach ?? 70;
  for (let t = 0; t < (cfg.steps ?? 40000); ) {
    const dt = cfg.every ?? 10000;
    await lab.run(dt); t += dt;
    const s = (await lab.read()).state;
    let mt = 0;
    for (let i = 0; i < N * N; i++) for (const k of [1, 2, 3]) mt += s[i * S4 + ix(`m${k}`)];
    const nb = [1, 2, 3].reduce((t, k) => t + blobs(s, N, lab.layout.S, ix(`phi${k}`), 0.5, 4).length, 0);
    const each = cfg.bubbles.map(([cx, cy, r, m, k = 0]) => {
      const P = ix(`phi${k + 1}`), M = ix(`m${k + 1}`);
      let a = 0, sx = 0, sy = 0, mm = 0;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        if (Math.hypot(x - cx, y - cy) > reach) continue;
        const p = s[(y * N + x) * S4 + P]; if (p > 0.5) { a++; sx += x; sy += y; mm += s[(y * N + x) * S4 + M]; }
      }
      if (!a) return 'gone';
      const gx = sx / a, gy = sy / a; let e = 0, e2 = 0, n = 0;
      for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
        if (Math.hypot(x - cx, y - cy) > reach) continue;
        const i = (y * N + x) * S4 + P, p = s[i];
        if (p > 0.5 && (s[i - S4] <= 0.5 || s[i + S4] <= 0.5 || s[i - N * S4] <= 0.5 || s[i + N * S4] <= 0.5)) { const d = Math.hypot(x - gx, y - gy); e += d; e2 += d * d; n++; }
      }
      const er = e / n;
      return `R ${Math.sqrt(a / Math.PI).toFixed(1)} (from ${r}) round±${Math.sqrt(Math.max(0, e2 / n - er * er)).toFixed(1)} m̄ ${(mm / a).toFixed(2)} (from ${m})`;
    });
    log(`${t / 1000}k: ${each.join(' | ')}  bubbles ${nb}  total m ${mt.toFixed(0)}`);
    if (cfg.tag) await saveFrame(`${cfg.tag}-${String(t).padStart(6, '0')}.png`, lab, { ri: 0, lo: 0, hi: 1, rgb: [ix('phi1'), ix('phi2'), ix('phi3')], scale: 1, caption: `t=${t}` });
  }
}
