// Natural gun hunt #2: in media where a lone soliton slowly divides, does the
// growing cluster ever shed gliders? Track stills and movers over a long run.
import { GS_HISTORY_WAVE } from '../src/rule';
import { makeLab, runAll, blobs, saveFrame, log, STARTERS, type Lab, type Blob } from './lab';

export default async function (cfg: { Fs?: number[]; ks?: number[]; steps?: number; N?: number }) {
  const N = cfg.N ?? 384, c = N / 2;
  const media = (cfg.Fs ?? [0.052, 0.054, 0.056, 0.058]).flatMap((F) => (cfg.ks ?? [0.063, 0.0635, 0.064, 0.0645]).map((k) => ({ F, k })));
  const runs: { g: { F: number; k: number }; lab: Lab; prev: Blob[]; hist: string[]; emitted: number }[] = [];
  for (const g of media) {
    const l = await makeLab(GS_HISTORY_WAVE, N, g);
    await l.place(STARTERS('starter-soliton-hw65'), c, c);
    runs.push({ g, lab: l, prev: [], hist: [], emitted: 0 });
  }
  const steps = cfg.steps ?? 90000, dt = 600;
  for (let t = 0; t < steps; t += 6000) {
    await runAll(runs.map((r) => r.lab), 6000 - dt);
    const before = await Promise.all(runs.map(async (r) => blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2)));
    await runAll(runs.map((r) => r.lab), dt);
    for (const [i, r] of runs.entries()) {
      const after = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2);
      let movers = 0;
      for (const q of after) {
        const p = before[i].reduce((m: Blob, o) => (Math.hypot(o.x - q.x, o.y - q.y) < Math.hypot(m.x - q.x, m.y - q.y) ? o : m), before[i][0] ?? q);
        if (Math.hypot(q.x - p.x, q.y - p.y) > 5 && Math.hypot(q.x - p.x, q.y - p.y) < 20) movers++;
      }
      r.emitted = Math.max(r.emitted, movers);
      r.hist.push(`${after.length - movers}/${movers}`);
    }
  }
  for (const r of runs) {
    log(`F=${r.g.F} k=${r.g.k}: still/moving every 6k: ${r.hist.join(' ')}`);
    if (r.emitted) await saveFrame(`F${r.g.F}-k${r.g.k}.png`, r.lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 1, caption: `F=${r.g.F} k=${r.g.k} t=${steps}` });
  }
}
