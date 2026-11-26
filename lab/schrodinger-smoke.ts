// node lab/run.mjs schrodinger-smoke
// Schrödinger's Smoke: tracks the vortex cores (local peaks of ψ2's share) and the flow's divergence, saves frames.
import { SCHRODINGER_SMOKE } from '../src/rule';
import { makeLab, saveFrame, log } from './lab';

export default async function (cfg: { steps?: number; parts?: number; globals?: Record<string, number> }) {
  const N = 256, parts = cfg.parts ?? 8;
  const l = await makeLab(SCHRODINGER_SMOKE, N, cfg.globals ?? {}, 'initial');
  const L = l.layout, S4 = L.S * 4, ix = (n: string) => L.reagents.indexOf(n);
  for (let k = 0; k <= parts; k++) {
    // whole steps: three passes each
    if (k) await l.run(3 * Math.round((cfg.steps ?? 3000) / parts));
    const { state } = await l.read();
    const core = (x: number, y: number) => state[(((y + N) % N) * N + ((x + N) % N)) * S4 + ix('core')];
    const cores: string[] = [];
    let d2 = 0, n2 = 0, bad = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const c = (y * N + x) * S4;
      d2 += state[c + ix('d')] ** 2;
      n2 += ['a1', 'b1', 'a2', 'b2'].reduce((s, r) => s + state[c + ix(r)] ** 2, 0);
      if (!Number.isFinite(state[c])) bad++;
      const v = core(x, y);
      if (v > 0.5 && [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].every(([i, j]) => v >= core(x + i, y + j))) cores.push(`(${x},${y})`);
    }
    log(`@${k}: cores ${cores.join(' ')} · rms div ${Math.sqrt(d2 / N / N).toExponential(2)} · mean |ψ|² ${(n2 / N / N).toFixed(4)}${bad ? ` NaN ${bad}` : ''}`);
    await saveFrame(`f${k}.png`, l, { ri: ix('dye'), lo: 0, hi: 1, scale: 1, caption: `@${k}` });
  }
}
