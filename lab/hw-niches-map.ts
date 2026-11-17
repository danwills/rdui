// What GS History+Wave Niches' medium can do: one species alone (all four the same F, k), started as History+Wave's
// opening (noise in a and b over the middle of the field), on a feed/kill grid. Logs the live share and how much it
// moves (the share of live cells that weren't live 300 steps before) and how elongated its blobs are, and saves a thumbnail of the history c per cell.
import * as R from '../src/rule';
import { makeLab, log, saveFrame, blobs } from './lab';
export default async function (cfg: { Fs: number[]; ks: number[]; steps?: number; tag?: string; set?: Record<string, number>; N?: number }) {
  const N = cfg.N ?? 128;
  const initial: R.Overlay[] = [
    ...[1, 2, 3, 4].map((i): R.Overlay => ({ chem: `a${i}`, op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'everywhere' } })),
    { chem: 'a1', op: 'overwrite', fill: { type: 'white_noise', low: 0.6, high: 0.7001 }, shape: { type: 'circle', cx: 0.5, cy: 0.5, r: 0.3 } },
    { chem: 'b1', op: 'overwrite', fill: { type: 'white_noise', low: -0.2, high: 0.42 }, shape: { type: 'circle', cx: 0.5, cy: 0.5, r: 0.3 } },
    { chem: 'd', op: 'overwrite', fill: { type: 'constant', value: 0.37 }, shape: { type: 'everywhere' } },
  ];
  for (const F of cfg.Fs) {
    const row: string[] = [];
    for (const k of cfg.ks) {
      const lab = await makeLab({ ...R.GS_HW_NICHES, initial }, N, { ...cfg.set, F1: F, k1: k, F2: 0, F3: 0, F4: 0 }, 'initial');
      const S4 = lab.layout.S * 4;
      await lab.run((cfg.steps ?? 20000) - 300);
      const before = (await lab.read()).state;
      await lab.run(300);
      const { state } = await lab.read();
      let live = 0, fresh = 0;
      for (let i = 0; i < N * N; i++) {
        if (state[i * S4 + 4] > 0.1) { live++; if (before[i * S4 + 4] <= 0.1) fresh++; }
      }
      // how wormy: the blobs' elongation, area-weighted (1 round)
      const bs = blobs(state, N, lab.layout.S, 4, 0.1, 8), ba = bs.reduce((t, b) => t + b.area, 0);
      const el = ba ? bs.reduce((t, b) => t + b.area * b.elong, 0) / ba : 0;
      row.push(`${(100 * live / N / N).toFixed(1).padStart(4)}%/${live ? (100 * fresh / live).toFixed(0).padStart(2) : ' -'}/${el ? el.toFixed(1) : '-'}`);
      await saveFrame(`${cfg.tag ?? 'map'}/F${F}-k${k}.png`, lab, { ri: lab.layout.reagents.indexOf('c'), lo: 0, hi: 1, scale: 1, caption: `${F} ${k}` });
      lab.sim.destroy();
    }
    log(`F ${F.toFixed(3)}: ${row.join('  ')}`);
  }
}
