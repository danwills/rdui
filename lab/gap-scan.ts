// node lab/run.mjs gap-scan
// Gap-junction step 1: where can a painted disc hold a solid blob of b (a bistable patch: on stays on, off stays off)?
// 8×8 patches of (F, k), each a disc r 14 painted with them in dead medium (k 0.075), seeded filled; after a while,
// each disc's mean b, its spread (solid vs spotty) and how much b leaked outside.
import * as R from '../src/rule';
import { makeLab, saveFrame, log } from './lab';

export default async function (cfg: { steps?: number; r?: number }) {
  const N = 512, P = 64, rad = cfg.r ?? 14;
  const Fs = [0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1], ks = [0.05, 0.052, 0.054, 0.056, 0.058, 0.06, 0.062, 0.064];
  const l = await makeLab(R.GRAY_SCOTT, N, {}, 'rest');
  const { state, params } = await l.sim.readRegion(0, 0, N, N);
  const S4 = l.layout.S * 4, P4 = l.layout.P * 4, iF = l.layout.paramNames.indexOf('F'), ik = l.layout.paramNames.indexOf('k');
  const ia = l.layout.reagents.indexOf('a'), ib = l.layout.reagents.indexOf('b');
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, px = Math.floor(x / P), py = Math.floor(y / P), dx = (x % P) - P / 2 + 0.5, dy = (y % P) - P / 2 + 0.5;
    const inside = dx * dx + dy * dy <= rad * rad;
    params[i * P4 + iF] = Fs[px];
    params[i * P4 + ik] = inside ? ks[py] : 0.075;
    state[i * S4 + ia] = inside ? 0.4 : 1;
    state[i * S4 + ib] = inside ? 0.3 : 0;
  }
  l.sim.writeRegion(0, 0, N, N, params, state);
  await l.run(cfg.steps ?? 15000);
  const { state: s } = await l.read();
  const rows: string[] = [];
  for (let py = 0; py < 8; py++) {
    const cells: string[] = [];
    for (let px = 0; px < 8; px++) {
      let n = 0, sum = 0, sq = 0, out = 0;
      for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
        const dx = x - P / 2 + 0.5, dy = y - P / 2 + 0.5, v = s[((py * P + y) * N + px * P + x) * S4 + ib];
        if (dx * dx + dy * dy <= rad * rad) { n++; sum += v; sq += v * v; } else out += v;
      }
      const m = sum / n, sd = Math.sqrt(Math.max(0, sq / n - m * m));
      cells.push(`${m.toFixed(2)}±${sd.toFixed(2)}${out > 1 ? '!' : ' '}`);
    }
    rows.push(`k ${ks[py].toFixed(3)}  ${cells.join(' ')}`);
  }
  log(`F        ${Fs.map((f) => f.toFixed(2).padEnd(10)).join(' ')}`);
  rows.forEach((r) => log(r));
  await saveFrame('scan.png', l, { ri: ib, lo: 0, hi: 0.4, scale: 1, caption: 'F → , k ↓' });
}
