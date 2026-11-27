// node lab/run.mjs brush-box
// Brush strokes as passes over just their box of cells (sim.brushAll): seed strokes across the wrap edges and corner,
// and a batch of 40 (more than the uniform ring's 32), should paint exactly the cells within the capsules (wrapped).
import * as R from '../src/rule';
import { BrushMode, type BrushStroke } from '../src/sim';
import { makeLab, log } from './lab';

export default async function () {
  const N = 64;
  const seg = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax, dy = by - ay, h = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / Math.max(dx * dx + dy * dy, 1e-6)));
    return Math.hypot(px - ax - dx * h, py - ay - dy * h);
  };
  const cases: [string, BrushStroke[]][] = [
    ['across x', [[58, 20, 70, 24]]],
    ['corner', [[62, 62, 66, 67]]],
    ['batch of 40', Array.from({ length: 40 }, (_, k) => [(k * 13) % 64, (k * 29) % 64, (k * 13) % 64 + 3, (k * 29) % 64 + 2])],
  ].map(([name, list]) => [name as string, (list as number[][]).map(([ax, ay, bx, by]): BrushStroke => ({ ax, ay, bx, by, radius: 4, mode: BrushMode.Seed, strength: 1, hardness: 1, paint: [], seed: [null, 1] }))]);
  for (const [name, strokes] of cases) {
    const l = await makeLab(R.GRAY_SCOTT, N);
    l.sim.brushAll(strokes);
    const { state } = await l.read();
    const S4 = l.layout.S * 4;
    let got = 0, want = 0, wrong = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const painted = state[(y * N + x) * S4 + 1] > 0.5;
      let inside = false;
      for (const b of strokes) for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N])
        if (seg(x + 0.5, y + 0.5, b.ax + ox, b.ay + oy, b.bx + ox, b.by + oy) < b.radius) inside = true;
      got += +painted; want += +inside; wrong += +(painted !== inside);
    }
    log(`${name}: painted ${got}, expected ${want}, mismatched ${wrong}`);
  }
}
