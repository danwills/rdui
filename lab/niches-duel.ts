// A duel in Gray-Scott Niches: species X (F, k) seeded as small spots across the left half, Y across
// the right, no walls. Logs each one's territory over time (where its b, blurred over ~8 cells, is the larger): balanced competitors hold
// about half each, a voracious one takes the field. For choosing scene line-ups.
//   node lab/run.mjs niches-duel '{"x":[0.0367,0.0649],"y":[0.029,0.057]}'
import * as R from '../src/rule';
import { makeLab, log, saveFrame } from './lab';

export default async function (cfg: { x: [number, number]; y: [number, number]; N?: number; steps?: number; every?: number; tag?: string; interfere?: number }) {
  const N = cfg.N ?? 256, steps = cfg.steps ?? 60000, every = cfg.every ?? 20000;
  const seeds: R.Overlay[] = [];
  // a grid of small seed spots, a1/b1 on the left, a2/b2 on the right
  for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) for (const s of [1, 2]) {
    const cx = (s === 1 ? 0.06 : 0.56) + (j + 0.5) * 0.095, cy = (i + 0.5) / 8;
    seeds.push({ chem: `a${s}`, op: 'overwrite', fill: { type: 'constant', value: 0.5 }, shape: { type: 'circle', cx, cy, r: 0.012 } },
      { chem: `b${s}`, op: 'overwrite', fill: { type: 'constant', value: 0.3 }, shape: { type: 'circle', cx, cy, r: 0.012 } });
  }
  const initial: R.Overlay[] = [...['a1', 'a2', 'a3', 'a4'].map((a): R.Overlay => ({ chem: a, op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'everywhere' } })), ...seeds];
  const lab = await makeLab({ ...R.GS_NICHES, initial }, N, { F1: cfg.x[0], k1: cfg.x[1], F2: cfg.y[0], k2: cfg.y[1], ...(cfg.interfere !== undefined ? { interfere: cfg.interfere } : {}) }, 'initial');
  const S4 = lab.layout.S * 4;
  const out: string[] = [];
  for (let t = every; t <= steps; t += every) {
    await lab.run(every);
    const { state } = await lab.read();
    // territory: where each species' b, blurred over ~8 cells, is the larger (sparse spots hold the ground between them)
    const blur = (c: number) => {
      const src = new Float32Array(N * N), tmp = new Float32Array(N * N), r = 8;
      for (let i = 0; i < N * N; i++) src[i] = state[i * S4 + c];
      for (let pass = 0; pass < 2; pass++) {
        const [from, to] = pass ? [tmp, src] : [src, tmp];
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          let s = 0;
          for (let d = -r; d <= r; d++) s += pass ? from[(((y + d) % N + N) % N) * N + x] : from[y * N + (((x + d) % N + N) % N)];
          to[y * N + x] = s;
        }
      }
      return src;
    };
    const m1 = blur(4), m2 = blur(5);
    let t1 = 0, t2 = 0;
    for (let i = 0; i < N * N; i++) if (m1[i] + m2[i] > 0.5) { if (m1[i] > m2[i]) t1++; else t2++; }
    out.push(`${t / 1000}k X ${Math.round((100 * t1) / (t1 + t2 || 1))}%`);
    if (cfg.tag && t === steps) await saveFrame(`${cfg.tag}.png`, lab, { ri: 8, lo: 0, hi: 0.5, ti: 9, tlo: 0.015, thi: 0.06, scale: 2, caption: `X ${cfg.x} Y ${cfg.y} t=${t}` });
  }
  log(`X ${cfg.x} vs Y ${cfg.y}: ${out.join('  ')}`);
}
