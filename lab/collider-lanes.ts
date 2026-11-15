// Per-lane soliton positions and power in the phase-collider scene (n = |ψ|² summed over each blob).
import * as R from '../src/rule';
import { makeLab, log } from './lab';
import type { Scene } from '../src/scenes';

export default async function (cfg: { scene?: string; checks: number[]; lanes?: number[]; set?: Record<string, number> }) {
  const sc: Scene = await (await fetch(`/scenes/${cfg.scene ?? 'schrodinger-phase-collider'}.json`)).json();
  const base = R.BUILTIN_RULES[+sc.rule.split(':')[1]];
  const lab = await makeLab({ ...base, initial: sc.initial! }, sc.size ?? 256, { ...sc.globals, ...cfg.set }, 'initial');
  const N = lab.N, S4 = lab.layout.S * 4;
  let t = 0;
  for (const c of cfg.checks) {
    if (c > t) { await lab.run(c - t); t = c; }
    const { state } = await lab.read();
    const parts: string[] = [];
    for (const ly of cfg.lanes ?? [0.2, 0.4, 0.6, 0.8]) {
      // column profile of power over the lane's band, split into blobs at gaps
      const prof = new Array(N).fill(0);
      for (let y = Math.round(ly * N) - 14; y <= Math.round(ly * N) + 14; y++) for (let x = 0; x < N; x++) { const j = (y * N + x) * S4; prof[x] += state[j] ** 2 + state[j + 1] ** 2; }
      const blobs: string[] = [];
      let m = 0, mx = 0;
      for (let x = 0; x <= N; x++) {
        if (x < N && prof[x] > 0.5) { m += prof[x]; mx += prof[x] * x; }
        else if (m > 0) { if (m > 20) blobs.push(`${(mx / m).toFixed(0)}:${m.toFixed(0)}`); m = 0; mx = 0; }
      }
      parts.push(blobs.join(' '));
    }
    log(`t=${t}  ` + parts.map((p, i) => `L${i}[${p}]`).join('  '));
  }
}
