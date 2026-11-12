// Search media for stiffer soliton fences: small rings, long runs; score on
// survivors, drift and radial spread. Also checks a glider still flies there.
import { GS_HISTORY_WAVE } from '../src/rule';
import { makeLab, runAll, blobs, log, STARTERS, type Lab } from './lab';

export default async function (cfg: { media?: Record<string, number>[]; steps?: number; R?: number; s?: number; batch?: number }) {
  const N = 128, c = 64, R = cfg.R ?? 40, s = cfg.s ?? 16, steps = cfg.steps ?? 150000, batch = cfg.batch ?? 25;
  const n = Math.round((2 * Math.PI * R) / s);
  const pts = Array.from({ length: n }, (_, i) => ({ x: c + R * Math.cos((i / n) * 2 * Math.PI), y: c + R * Math.sin((i / n) * 2 * Math.PI) }));
  const media = cfg.media ?? [0.05, 0.052, 0.054, 0.056, 0.058].flatMap((F) => [0.0645, 0.065, 0.0655, 0.066, 0.067].map((k) => ({ F, k })));
  const rows: Record<string, unknown>[] = [];
  for (let j = 0; j < media.length; j += batch) {
    const runs: { g: Record<string, number>; ring: Lab; gl: Lab; glOk: string }[] = [];
    for (const g of media.slice(j, j + batch)) {
      const ring = await makeLab(GS_HISTORY_WAVE, N, g);
      for (const p of pts) await ring.place(STARTERS('starter-soliton-hw65'), p.x, p.y);
      const gl = await makeLab(GS_HISTORY_WAVE, N, g);
      await gl.place(STARTERS('starter-glider-hw65'), 30, c);
      runs.push({ g, ring, gl, glOk: '' });
    }
    // glider check: alone, still one blob moving after 6k steps
    await runAll(runs.map((r) => r.gl), 3000);
    const g0 = await Promise.all(runs.map(async (r) => blobs((await r.gl.read()).state, N, r.gl.layout.S, 1, 0.2)));
    await runAll(runs.map((r) => r.gl), 3000);
    for (const [i, r] of runs.entries()) {
      const g1 = blobs((await r.gl.read()).state, N, r.gl.layout.S, 1, 0.2);
      r.glOk = g0[i].length === 1 && g1.length === 1 ? `${((Math.hypot(((g1[0].x - g0[i][0].x + N * 1.5) % N) - N / 2, g1[0].y - g0[i][0].y) / 3)).toFixed(1)}px/k` : `${g1.length} blobs`;
      r.gl.sim.destroy();
    }
    await runAll(runs.map((r) => r.ring), steps);
    for (const r of runs) {
      const bs = blobs((await r.ring.read()).state, N, r.ring.layout.S, 1, 0.2);
      const d = pts.map((p) => Math.min(...bs.map((b) => Math.hypot(b.x - p.x, b.y - p.y)), 99)).sort((a, b) => a - b);
      const radii = bs.map((b) => Math.hypot(b.x - c, b.y - c));
      const row = { ...r.g, blobs: bs.length, n, medDrift: +d[n >> 1].toFixed(1), maxDrift: +d[n - 1].toFixed(1), rMin: +Math.min(...radii).toFixed(1), rMax: +Math.max(...radii).toFixed(1), glider: r.glOk };
      rows.push(row);
      log(`F=${r.g.F} k=${r.g.k}: ${bs.length}/${n} blobs, drift med ${row.medDrift} max ${row.maxDrift}, radius ${row.rMin}–${row.rMax}, glider ${r.glOk}`);
      r.ring.sim.destroy();
    }
  }
  return rows;
}
