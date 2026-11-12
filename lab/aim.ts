// Glider aiming: track the starter glider in each orientation; report heading,
// speed and straightness so scenes can aim it.
import { GS_HISTORY_WAVE } from '../src/rule';
import { makeLab, glider, blobs, wrapDelta, log } from './lab';

export default async function (cfg: { steps?: number; every?: number; N?: number }) {
  const N = cfg.N ?? 256, steps = cfg.steps ?? 12000, every = cfg.every ?? 500;
  const out: Record<string, unknown> = {};
  for (const flip of [false, true]) for (const rot of [0, 1, 2, 3]) {
    const lab = await makeLab(GS_HISTORY_WAVE, N);
    lab.place(glider(), N / 2, N / 2, { rot, flip });
    const track: [number, number, number][] = [];
    let ux = 0, uy = 0, px = NaN, py = NaN, count = 0;
    for (let t = 0; t <= steps; t += every) {
      if (t) await lab.run(every);
      const bs = blobs((await lab.read()).state, N, lab.layout.S, 1, 0.2);
      count = bs.length;
      if (!bs.length) break;
      const b = bs.sort((a, c) => c.area - a.area)[0];
      if (!Number.isNaN(px)) { ux += wrapDelta(px, b.x, N); uy += wrapDelta(py, b.y, N); }
      px = b.x; py = b.y;
      track.push([t, ux, uy]);
    }
    // least-squares line through the track after a warm-up
    const pts = track.filter(([t]) => t >= 2000);
    const n = pts.length, mt = pts.reduce((s, p) => s + p[0], 0) / n;
    const vx = pts.reduce((s, p) => s + (p[0] - mt) * p[1], 0) / pts.reduce((s, p) => s + (p[0] - mt) ** 2, 0);
    const vy = pts.reduce((s, p) => s + (p[0] - mt) * p[2], 0) / pts.reduce((s, p) => s + (p[0] - mt) ** 2, 0);
    const mx = pts.reduce((s, p) => s + p[1], 0) / n, my = pts.reduce((s, p) => s + p[2], 0) / n;
    const resid = Math.sqrt(pts.reduce((s, p) => s + (p[1] - mx - vx * (p[0] - mt)) ** 2 + (p[2] - my - vy * (p[0] - mt)) ** 2, 0) / n);
    const key = `rot${rot}${flip ? 'f' : ''}`;
    const r = { speed: Math.hypot(vx, vy) * 1000, heading: (Math.atan2(vy, vx) * 180) / Math.PI, resid, blobs: count, end: track.at(-1) };
    out[key] = r;
    log(key, `speed ${r.speed.toFixed(2)} px/1000 steps, heading ${r.heading.toFixed(1)}°, wobble ${resid.toFixed(2)} px, blobs at end ${count}`);
  }
  return out;
}
