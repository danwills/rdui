// Scan F,k for media where a worm ring persists AND the glider stamp flies.
import { loadBundled } from '../src/ready';
import { makeLab, runAll, blobs, log, STARTERS, type Lab } from './lab';

export default async function (cfg: { Fs?: number[]; ks?: number[]; steps?: number; media?: Record<string, number>[]; spot?: number }) {
  const N = 160, c = 80, rule = (await loadBundled('grayscott-historyWave_fuseWorms')).rule;
  const Fs = cfg.Fs ?? [0.046, 0.048, 0.05, 0.052, 0.054], ks = cfg.ks ?? [0.063, 0.0633, 0.0636, 0.0639];
  const media: Record<string, number>[] = cfg.media ?? Fs.flatMap((F) => ks.map((k) => ({ F, k })));
  const runs: { g: Record<string, number>; ring: Lab; gl: Lab }[] = [];
  for (const g of media) {
    const ring = await makeLab(rule, N, g);
    if (cfg.spot) {
      // a disk of worm chemistry instead of the ring
      const CORE: Record<string, number> = { a: 0.407, b: 0.359, c: 0.363, d: 0.205, e: -0.002 };
      const r = cfg.spot, sz = 2 * r + 4, x0 = c - sz / 2, { state } = await ring.sim.readRegion(x0, x0, sz, sz);
      const R = ring.layout.reagents, S4 = ring.layout.S * 4;
      for (let j = 0; j < sz; j++) for (let i = 0; i < sz; i++) if (Math.hypot(i + 0.5 - sz / 2, j + 0.5 - sz / 2) <= r) R.forEach((n, k) => { if (n in CORE) state[(j * sz + i) * S4 + k] = CORE[n]; });
      ring.sim.writeRegion(x0, x0, sz, sz, undefined, state);
    } else await ring.place(STARTERS('starter-fw-worm-ring-r25'), c, c);
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
    const rok = cfg.spot ? (bs.length === 1 && bs[0].elong < 1.6 && bs[0].area < 200 ? `SPOT ok a${bs[0].area}` : `spot → ${bs.length} blobs${bs[0] ? ` (a${bs[0].area} e${bs[0].elong.toFixed(1)})` : ''}`) : bs.length === 1 && bs[0].elong < 1.5 ? `RING ok a${bs[0].area}` : `ring → ${bs.length} blobs${bs[0] ? ` (a${bs[0].area})` : ''}`;
    log(`${Object.entries(r.g).map(([n, v]) => `${n}=${v}`).join(' ')}: ${rok}; ${gok}`);
    r.ring.sim.destroy(); r.gl.sim.destroy();
  }
}
