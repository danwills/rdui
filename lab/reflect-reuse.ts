// Reuse test: fire gliders one after another down the same lane at a
// reflecting cluster; report each one's outcome and the cluster's drift.
import { GS_HISTORY_WAVE } from '../src/rule';
import { makeLab, blobs, saveFrame, log, STARTERS } from './lab';

const D = 25;
const SHAPES: Record<string, [number, number][]> = {
  line3: [[-D, 0], [0, 0], [D, 0]],
  square: [[-D / 2, -D / 2], [D / 2, -D / 2], [-D / 2, D / 2], [D / 2, D / 2]],
  pair: [[-D / 2, 0], [D / 2, 0]],
};

export default async function (cfg: { shape: string; ang: number; off: number; shots?: number; gap?: number; N?: number }) {
  const N = cfg.N ?? 256, c = N / 2, g = { F: 0.052, k: 0.066 };
  const a = (cfg.ang * Math.PI) / 180;
  const pts = SHAPES[cfg.shape].map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
  const l = await makeLab(GS_HISTORY_WAVE, N, g);
  for (const [x, y] of pts) await l.place(STARTERS('starter-soliton-hw65'), c + x, c + y);
  await l.run(4000);
  const home = blobs((await l.read()).state, N, l.layout.S, 1, 0.2);
  const left = Math.min(...pts.map((p) => p[0])) - 45;
  for (let s = 0; s < (cfg.shots ?? 4); s++) {
    await l.place(STARTERS('starter-glider-hw65'), c + left, c + cfg.off);
    await l.run(6500);
    const mid = blobs((await l.read()).state, N, l.layout.S, 1, 0.2);
    await l.run(500);
    const after = blobs((await l.read()).state, N, l.layout.S, 1, 0.2);
    const out: string[] = [];
    const stills = after.filter((q) => { const p = mid.reduce((m, o) => (Math.hypot(o.x - q.x, o.y - q.y) < Math.hypot(m.x - q.x, m.y - q.y) ? o : m)); const d = Math.hypot(q.x - p.x, q.y - p.y); if (d >= 2.5) out.push(`${Math.round((Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI)}°`); return d < 2.5; });
    const drift = home.map((p) => Math.min(...stills.map((q) => Math.hypot(q.x - p.x, q.y - p.y)), 99));
    log(`shot ${s + 1}: gliders out ${out.join(',') || 'none'}; cluster ${stills.length}/${home.length}, drift ${drift.map((d) => d.toFixed(1)).join(' ')}`);
    await saveFrame(`${cfg.shape}-${cfg.ang}-shot${s + 1}.png`, l, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 2, caption: `shot ${s + 1}: ${out.join(',') || 'eaten'}` });
    // let the outgoing glider leave the field area before the next shot (absorb it by waiting; torus may wrap)
    await l.run(cfg.gap ?? 6000);
  }
}
