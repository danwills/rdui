// Long-term stability of a soliton ring: record frames and per-soliton drift.
import { GS_HISTORY_WAVE } from '../src/rule';
import { makeLab, blobs, saveFrame, log, STARTERS } from './lab';

export default async function (cfg: { F?: number; k?: number; R?: number; s?: number; steps?: number; every?: number; tag?: string; N?: number; globals?: Record<string, number> }) {
  const N = cfg.N ?? 256, c = N / 2, R = cfg.R ?? 70, s = cfg.s ?? 16;
  const g = { F: cfg.F ?? 0.054, k: cfg.k ?? 0.065, ...cfg.globals };
  const n = Math.round((2 * Math.PI * R) / s);
  const pts = Array.from({ length: n }, (_, i) => ({ x: c + R * Math.cos((i / n) * 2 * Math.PI), y: c + R * Math.sin((i / n) * 2 * Math.PI) }));
  const lab = await makeLab(GS_HISTORY_WAVE, N, g);
  for (const p of pts) await lab.place(STARTERS('starter-soliton-hw65'), p.x, p.y);
  const steps = cfg.steps ?? 300000, every = cfg.every ?? 3000, tag = cfg.tag ?? `F${g.F}-k${g.k}`;
  for (let t = 0, f = 0; t <= steps; t += every, f++) {
    if (t) await lab.run(every);
    const bs = blobs((await lab.read()).state, N, lab.layout.S, 1, 0.2);
    const d = pts.map((p) => Math.min(...bs.map((b) => Math.hypot(b.x - p.x, b.y - p.y)), 99));
    const radii = bs.map((b) => Math.hypot(b.x - c, b.y - c));
    if (t % 30000 === 0) log(`t=${t}: ${bs.length}/${n} blobs, drift median ${d.sort((a, b) => a - b)[n >> 1].toFixed(1)} max ${Math.max(...d).toFixed(1)} px, radius ${Math.min(...radii).toFixed(1)}–${Math.max(...radii).toFixed(1)}`);
    await saveFrame(`${tag}/f${String(f).padStart(4, '0')}.png`, lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 2, caption: `soliton ring F=${g.F} k=${g.k}  t=${t}  ${bs.length}/${n}` });
  }
}
