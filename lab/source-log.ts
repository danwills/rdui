// Measure a natural glider source: one soliton in a big field; log each new
// glider leaving the cluster (time, direction, speed) to look for rhythm.
import { GS_HISTORY_WAVE } from '../src/rule';
import { makeLab, blobs, saveFrame, log, STARTERS, type Blob } from './lab';

export default async function (cfg: { F: number; k: number; N?: number; steps?: number; dt?: number }) {
  const N = cfg.N ?? 768, c = N / 2, dt = cfg.dt ?? 400, steps = cfg.steps ?? 70000;
  const lab = await makeLab(GS_HISTORY_WAVE, N, { F: cfg.F, k: cfg.k });
  await lab.place(STARTERS('starter-soliton-hw65'), c, c);
  let prev: Blob[] = [];
  const known: { x: number; y: number }[] = []; // gliders already counted (predicted positions)
  const vel = new Map<Blob, [number, number]>();
  const events: { t: number; angle: number; speed: number }[] = [];
  for (let t = dt, f = 0; t <= steps; t += dt) {
    await lab.run(dt);
    const bs = blobs((await lab.read()).state, N, lab.layout.S, 1, 0.2);
    // cluster = blobs within 40 px of the densest point (the nest); movers = matched blobs that moved 3–15 px
    for (const b of bs) {
      const p = prev.reduce((m: Blob | null, q) => (!m || Math.hypot(q.x - b.x, q.y - b.y) < Math.hypot(m.x - b.x, m.y - b.y) ? q : m), null);
      if (!p) continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d < 3 || d > 15) continue;
      vel.set(b, [b.x - p.x, b.y - p.y]);
      const r = Math.hypot(b.x - c, b.y - c);
      // count a glider once: when it first appears moving outward, not near an already-counted track
      const outward = ((b.x - c) * (b.x - p.x) + (b.y - c) * (b.y - p.y)) / (r * d) > 0.8;
      if (outward && !known.some((k) => Math.hypot(k.x - b.x, k.y - b.y) < 12)) {
        events.push({ t, angle: Math.round((Math.atan2(b.y - c, b.x - c) * 180) / Math.PI), speed: +((d / dt) * 1000).toFixed(1) });
      }
    }
    known.length = 0;
    for (const [b, [vx, vy]] of vel) known.push({ x: b.x + vx, y: b.y + vy });
    vel.clear();
    prev = bs;
    if (t % 4000 === 0) {
      const near = bs.filter((b) => Math.hypot(b.x - c, b.y - c) < 50).length;
      log(`t=${t}: ${bs.length} blobs (${near} in nest), emissions so far ${events.length}`);
      await saveFrame(`F${cfg.F}-k${cfg.k}/f${String(f++).padStart(4, '0')}.png`, lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 1, caption: `F=${cfg.F} k=${cfg.k} t=${t} emitted ${events.length}` });
    }
  }
  log('events', JSON.stringify(events));
  const gaps = events.slice(1).map((e, i) => e.t - events[i].t);
  log('gaps between emissions:', gaps.join(' '));
  return events;
}
