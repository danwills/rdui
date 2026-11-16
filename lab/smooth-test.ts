// The Smooth brush on walls: a jagged wall, specks, a thin (2-cell) wall and a square, before and after.
import * as R from '../src/rule';
import { BrushMode } from '../src/sim';
import { makeLab, log } from './lab';
export default async function (cfg: { radius?: number; passes?: number; clear?: boolean }) {
  const N = 64, lab = await makeLab(R.GRAY_SCOTT, N);
  const P4 = lab.layout.P * 4, S4 = lab.layout.S * 4;
  const wall = (ax: number, ay: number, bx: number, by: number, radius: number) =>
    lab.sim.brush({ ax, ay, bx, by, radius, mode: BrushMode.Wall, strength: 1, hardness: 1, paint: [], base: 1 });
  // a jagged thick wall: overlapping zigzag strokes
  for (let y = 4; y < 60; y += 4) wall(14 + ((y / 4) % 2) * 3, y, 14 + (((y + 4) / 4) % 2) * 3, y + 4, 2.6);
  wall(40, 4, 40, 60, 1); // thin, 2 cells
  for (const [x, y] of [[26, 10], [28, 30], [27, 50]]) wall(x, y, x, y, 0.8); // specks
  wall(50, 20, 58, 20, 0.6); wall(50, 20, 50, 40, 0.6); // nothing (too small): then a square
  for (let y = 44; y < 56; y++) wall(48, y + 0.5, 60, y + 0.5, 0.6);
  // the pattern: noise in b to see the blur
  const show = async (title: string) => {
    const { params, state } = await lab.read();
    let walls = 0, vb = 0;
    const rows: string[] = [];
    for (let y = 0; y < N; y += 2) {
      let r = '';
      for (let x = 0; x < N; x++) { const w = params[(y * N + x) * P4] > 0.5; r += w ? '#' : '.'; }
      rows.push(r);
    }
    for (let i = 0; i < N * N; i++) { if (params[i * P4] > 0.5) walls++; vb += Math.abs(state[i * S4 + 1] - state[((i + 1) % (N * N)) * S4 + 1]); }
    log(`${title}: ${walls} wall cells, b roughness ${vb.toFixed(1)}\n${rows.join('\n')}`);
  };
  lab.sim.brush({ ax: 32, ay: 32, bx: 32, by: 32, radius: 100, mode: BrushMode.Seed, strength: 1, hardness: 1, paint: [] });
  await show('before');
  const r = cfg.radius ?? 6;
  for (let p = 0; p < (cfg.passes ?? 10); p++)
    for (let y = 0; y <= N; y += 2) lab.sim.brush({ ax: 0, ay: y, bx: N, by: y, radius: r, mode: BrushMode.Smooth, strength: 0.5, hardness: 0.5, paint: [], clear: cfg.clear });
  await show('after');
}
