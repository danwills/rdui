// Isotropy: launch the glider rotated to headings 0–45°; compare its early
// and late heading and speed with the stencil and the spectral Laplacian.
import * as R from '../src/rule';
import { rotateStampBy } from '../src/stamps';
import { makeLab, runAll, blobs, log, STARTERS, HW_STD, type Lab } from './lab';

export default async function (cfg: { modes?: ('stencil' | 'spectral')[]; heads?: number[] }) {
  const N = 256, c = 128;
  const heads = cfg.heads ?? [0, 5, 10, 15, 20, 25, 30, 35, 40, 45];
  for (const mode of cfg.modes ?? ['stencil', 'spectral']) {
    const rule = { ...R.GS_HISTORY_WAVE, laplacian: mode };
    const runs: { h: number; lab: Lab; p: { x: number; y: number }[] }[] = [];
    for (const h of heads) {
      const l = await makeLab(rule, N, HW_STD);
      await l.place(rotateStampBy(STARTERS('starter-glider-hw65'), h), c - 60 * Math.cos((h * Math.PI) / 180), c - 60 * Math.sin((h * Math.PI) / 180));
      runs.push({ h, lab: l, p: [] });
    }
    for (const t of [1000, 3000, 9000, 11000]) {
      await runAll(runs.map((r) => r.lab), t - (runs[0].p.length ? [1000, 3000, 9000, 11000][runs[0].p.length - 1] : 0));
      for (const r of runs) { const b = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2); r.p.push(b.length === 1 ? b[0] : { x: NaN, y: NaN }); }
    }
    const unwrap = (d: number) => ((d + N * 1.5) % N) - N / 2;
    const rows = runs.map((r) => {
      const seg = (i: number, j: number) => { const dx = unwrap(r.p[j].x - r.p[i].x), dy = unwrap(r.p[j].y - r.p[i].y); return { h: (Math.atan2(dy, dx) * 180) / Math.PI, v: Math.hypot(dx, dy) / 2 }; };
      const e = seg(0, 1), l = seg(2, 3);
      r.lab.sim.destroy();
      return Number.isNaN(l.h) ? `${r.h}°: lost` : `${String(r.h).padStart(2)}° → early ${e.h.toFixed(1)}°, late ${l.h.toFixed(1)}° @ ${l.v.toFixed(2)} px/k`;
    });
    log(`${mode}:\n  ${rows.join('\n  ')}`);
  }
}
