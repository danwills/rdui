// Scan F,k for media where a worm ring persists AND the glider stamp flies.
import { loadBundled } from '../src/ready';
import { makeLab, runAll, blobs, log, STARTERS, type Lab } from './lab';

export default async function (cfg: { Fs?: number[]; ks?: number[]; steps?: number }) {
  const N = 160, c = 80, rule = (await loadBundled('grayscott-historyWave_fuseWorms')).rule;
  const Fs = cfg.Fs ?? [0.046, 0.048, 0.05, 0.052, 0.054], ks = cfg.ks ?? [0.063, 0.0633, 0.0636, 0.0639];
  const media = Fs.flatMap((F) => ks.map((k) => ({ F, k })));
  const runs: { g: { F: number; k: number }; ring: Lab; gl: Lab }[] = [];
  for (const g of media) {
    const ring = await makeLab(rule, N, g); await ring.place(STARTERS('starter-fw-worm-ring-r25'), c, c);
    const gl = await makeLab(rule, N, g); await gl.place(STARTERS('starter-fw-glider'), c, c);
    runs.push({ g, ring, gl });
  }
  await runAll(runs.flatMap((r) => [r.ring, r.gl]), 1500);
  const g0 = await Promise.all(runs.map(async (r) => blobs((await r.gl.read()).state, N, r.gl.layout.S, 1, 0.2)));
  await runAll(runs.map((r) => r.gl), 4000);
  const g1 = await Promise.all(runs.map(async (r) => blobs((await r.gl.read()).state, N, r.gl.layout.S, 1, 0.2)));
  await runAll(runs.map((r) => r.ring), cfg.steps ?? 40000);
  for (const [i, r] of runs.entries()) {
    const gok = g0[i].length === 1 && g1[i].length === 1 ? `glider ${(Math.hypot(g1[i][0].x - g0[i][0].x, g1[i][0].y - g0[i][0].y) / 4).toFixed(1)} px/k` : `glider ${g0[i].length}→${g1[i].length} blobs`;
    const bs = blobs((await r.ring.read()).state, N, r.ring.layout.S, 1, 0.2).sort((p, q) => q.area - p.area);
    const rok = bs.length === 1 && bs[0].elong < 1.5 ? `RING ok a${bs[0].area}` : `ring → ${bs.length} blobs${bs[0] ? ` (a${bs[0].area})` : ''}`;
    log(`F=${r.g.F} k=${r.g.k}: ${rok}; ${gok}`);
    r.ring.sim.destroy(); r.gl.sim.destroy();
  }
}
