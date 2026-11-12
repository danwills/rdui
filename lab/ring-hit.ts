// Fire the fuseWorms glider at a settled worm ring at various impact offsets.
import { loadBundled } from '../src/ready';
import { rotateStampBy } from '../src/stamps';
import { makeLab, runAll, blobs, saveFrame, log, STARTERS, type Lab } from './lab';

export default async function (cfg: { g?: Record<string, number>; ring?: string; offsets?: number[]; settle?: number; steps?: number }) {
  const N = 256, c = 128, g = cfg.g ?? { F: 0.05, k: 0.0644 };
  const rule = (await loadBundled('grayscott-historyWave_fuseWorms')).rule;
  const gl = STARTERS('starter-fw-glider'), ringSt = STARTERS(cfg.ring ?? 'starter-fw-worm-ring-r25');
  // 1. does the glider live in this medium, and which way does it fly?
  const t = await makeLab(rule, N, g);
  await t.place(gl, c, c);
  await t.run(1000);
  const p0 = blobs((await t.read()).state, N, t.layout.S, 1, 0.2);
  await t.run(4000);
  const p1 = blobs((await t.read()).state, N, t.layout.S, 1, 0.2);
  if (p0.length !== 1 || p1.length !== 1) { log(`glider in this medium: ${p0.length}→${p1.length} blobs — not a clean glider`); return; }
  const head = Math.atan2(p1[0].y - p0[0].y, p1[0].x - p0[0].x), v = Math.hypot(p1[0].y - p0[0].y, p1[0].x - p0[0].x) / 4;
  log(`glider alone: heading ${((head * 180) / Math.PI).toFixed(0)}°, ${v.toFixed(1)} px/k`);
  t.sim.destroy();
  if (v < 2) return;
  // 2. rings + gliders fired from the left (heading 0°) at offset b
  const aimed = rotateStampBy(gl, -(head * 180) / Math.PI);
  const offs = cfg.offsets ?? [0, 6, 12, 18, 22, 26, 30, 36];
  const runs: { b: number; lab: Lab }[] = [];
  for (const b of offs) { const l = await makeLab(rule, N, g); await l.place(ringSt, c, c); runs.push({ b, lab: l }); }
  await runAll(runs.map((r) => r.lab), cfg.settle ?? 20000);
  const r0 = await Promise.all(runs.map(async (r) => blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2).sort((p, q) => q.area - p.area)[0]));
  for (const r of runs) await r.lab.place(aimed, c - 75, c + r.b);
  await runAll(runs.map((r) => r.lab), cfg.steps ?? 30000);
  for (const [i, r] of runs.entries()) {
    const bs = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2).sort((p, q) => q.area - p.area);
    const ring = bs[0], rest = bs.slice(1);
    const intact = ring && ring.area > 0.6 * r0[i].area && ring.elong < 1.5;
    log(`b=${String(r.b).padStart(2)}: ring ${intact ? `intact (area ${r0[i].area}→${ring.area}, moved ${Math.hypot(ring.x - r0[i].x, ring.y - r0[i].y).toFixed(1)} px)` : `changed: ${bs.length} blobs, largest a${ring?.area ?? 0} e${ring?.elong.toFixed(1) ?? '-'}`}; other blobs ${rest.length}${rest.length ? ' [' + rest.map((q) => `(${q.x.toFixed(0)},${q.y.toFixed(0)}) a${q.area}`).join(' ') + ']' : ''}`);
    await saveFrame(`b${r.b}.png`, r.lab, { ri: 1, lo: 0, hi: 0.5, ti: 3, tlo: 0, thi: 0.35, scale: 2, caption: `glider at offset ${r.b}` });
    r.lab.sim.destroy();
  }
}
