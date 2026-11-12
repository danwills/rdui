// Reusability: a train of gliders at the soliton-chain 90° reflector.
import { GS_HISTORY_WAVE } from '../src/rule';
import { stampFromJSON } from '../src/stamps';
import { makeLab, blobs, saveFrame, log } from './lab';

export default async function (cfg: { eaters?: { y: number; x0: number; x1: number; s: number }; s?: number; th?: number; off?: number; gap?: number; count?: number; steps?: number; every?: number; frames?: boolean }) {
  const N = 256, c = 128, g = { F: 0.054, k: 0.065 };
  const sol = stampFromJSON(await (await fetch('/lab/out/still-hit/soliton.json')).json());
  const gl = stampFromJSON(await (await fetch('/lab/out/still-hit/glider.json')).json());
  const s = cfg.s ?? 16, th = cfg.th ?? 65, off = cfg.off ?? 10;
  const lab = await makeLab(GS_HISTORY_WAVE, N, g);
  const a = (th * Math.PI) / 180;
  const wall = Array.from({ length: 5 }, (_, i) => ({ x: c + 20 + (i - 2) * s * Math.sin(a), y: c - 30 + (i - 2) * s * Math.cos(a) }));
  for (const p of wall) lab.place(sol, p.x, p.y);
  // optional natural catcher: a row of solitons across the exit lanes
  const eaters: { x: number; y: number }[] = [];
  if (cfg.eaters) for (let x = cfg.eaters.x0; x <= cfg.eaters.x1; x += cfg.eaters.s) eaters.push({ x, y: cfg.eaters.y });
  for (const p of eaters) lab.place(sol, p.x, p.y);
  wall.push(...eaters);
  // gliders queued on the lane to the left, `gap` px apart (the absorber-free torus wraps, so keep the train short)
  const gap = cfg.gap ?? 45;
  for (let i = 0; i < (cfg.count ?? 3); i++) lab.place(gl, c - 60 - i * gap, c - 30 + off);
  const every = cfg.every ?? 200, steps = cfg.steps ?? 16000;
  let f = 0;
  for (let t = 0; t <= steps; t += every) {
    if (t) await lab.run(every);
    if (t % 2000 === 0) {
      const bs = blobs((await lab.read()).state, N, lab.layout.S, 1, 0.2);
      const intact = wall.filter((w) => bs.some((q) => Math.hypot(q.x - w.x, q.y - w.y) < 4)).length;
      log(`t=${t}: ${bs.length} blobs, solitons ${intact}/${wall.length}, others: ${bs.filter((q) => !wall.some((w) => Math.hypot(q.x - w.x, q.y - w.y) < 4)).map((q) => `${q.x.toFixed(0)},${q.y.toFixed(0)}`).join(' ')}`);
    }
    if (cfg.frames !== false) await saveFrame(`f${String(f++).padStart(4, '0')}.png`, lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 2, caption: `soliton-chain reflector  t=${t}` });
  }
}
