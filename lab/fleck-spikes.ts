// Are there one-cell spikes ("flecks") in the Gray-Scott + c state itself? Runs the rule and, at each check,
// counts cells that differ from the mean of their four neighbours by more than each threshold, per reagent,
// and lists the worst few (where, and what the neighbourhood looks like).
//   node lab/run.mjs fleck-spikes '{"at":[500,2000,6000]}'
import * as R from '../src/rule';
import { makeLab, log } from './lab';

export default async function (cfg: { at?: number[]; N?: number; globals?: Record<string, number> }) {
  const N = cfg.N ?? 512;
  const lab = await makeLab(R.GS_FLECK, N, cfg.globals ?? {}, 'initial');
  const S4 = lab.layout.S * 4;
  let t = 0;
  for (const T of cfg.at ?? [500, 2000, 6000]) {
    await lab.run(T - t);
    t = T;
    const { state } = await lab.read();
    const v = (x: number, y: number, r: number) => state[(((y + N) % N) * N + ((x + N) % N)) * S4 + r];
    const out: string[] = [];
    for (const [r, name] of ['a', 'b', 'c'].entries()) {
      const counts = [0.01, 0.03, 0.1].map(() => 0);
      const worst: [number, number, number][] = [];
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const d = v(x, y, r) - (v(x + 1, y, r) + v(x - 1, y, r) + v(x, y + 1, r) + v(x, y - 1, r)) / 4;
        [0.01, 0.03, 0.1].forEach((th, i) => { if (Math.abs(d) > th) counts[i]++; });
        if (Math.abs(d) > 0.03) { worst.push([Math.abs(d), x, y]); if (worst.length > 400) { worst.sort((p, q) => q[0] - p[0]); worst.length = 50; } }
      }
      worst.sort((p, q) => q[0] - p[0]);
      out.push(`${name}: |cell − neighbours| > 0.01: ${counts[0]}, > 0.03: ${counts[1]}, > 0.1: ${counts[2]}` +
        (worst.length ? `; worst ${worst.slice(0, 3).map(([d, x, y]) => `${d.toFixed(3)} at (${x},${y}) [${v(x, y, r).toFixed(3)} vs ${[v(x + 1, y, r), v(x - 1, y, r), v(x, y + 1, r), v(x, y - 1, r)].map((q) => q.toFixed(3)).join(' ')}]`).join(', ')}` : ''));
    }
    log(`t=${T}\n  ${out.join('\n  ')}`);
  }
}
