// Aim by arbitrary-angle rotation: does the heading follow the stamp angle?
import { GS_HISTORY_WAVE } from '../src/rule';
import { rotateStampBy } from '../src/stamps';
import { makeLab, glider, blobs, wrapDelta, log } from './lab';

export default async function (cfg: { angles?: number[]; steps?: number }) {
  const N = (cfg as { N?: number }).N ?? 256, steps = cfg.steps ?? 10000, every = 500;
  const out: Record<string, unknown> = {};
  for (const ang of cfg.angles ?? [-8, 37, 82, 127, 172]) {
    const lab = await makeLab(GS_HISTORY_WAVE, N);
    lab.place(rotateStampBy(glider(), ang), N / 2, N / 2);
    let ux = 0, uy = 0, px = NaN, py = NaN, nb = 0;
    const pts: [number, number, number][] = [];
    for (let t = 0; t <= steps; t += every) {
      if (t) await lab.run(every);
      const bs = blobs((await lab.read()).state, N, lab.layout.S, 1, 0.2);
      nb = bs.length;
      if (!nb) break;
      const b = bs.sort((a, c) => c.area - a.area)[0];
      if (!Number.isNaN(px)) { ux += wrapDelta(px, b.x, N); uy += wrapDelta(py, b.y, N); }
      px = b.x; py = b.y;
      if (t >= 2000) pts.push([t, ux, uy]);
    }
    if (pts.length < 3) { log(`${ang}°: died`); out[ang] = null; continue; }
    const [t0, x0, y0] = pts[0], [t1, x1, y1] = pts.at(-1)!;
    const head = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
    const spd = (Math.hypot(x1 - x0, y1 - y0) / (t1 - t0)) * 1000;
    out[ang] = { heading: head, speed: spd, blobs: nb };
    const win = [];
    for (let i = 4; i < pts.length; i += 4) win.push(((Math.atan2(pts[i][2] - pts[i - 4][2], pts[i][1] - pts[i - 4][1]) * 180) / Math.PI).toFixed(1));
    log(`  ${ang}° windows: ${win.join(' ')}`);
    log(`rotated ${ang}° → heading ${head.toFixed(1)}° (expected ${(8 + ang).toFixed(0)}°), speed ${spd.toFixed(2)}, blobs ${nb}`);
  }
  return out;
}
