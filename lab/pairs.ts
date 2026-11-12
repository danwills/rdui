// Do solitons bind? Place two (and rows of 3) at various spacings in the
// stable medium; report count and spacing after a long settle.
import { GS_HISTORY_WAVE } from '../src/rule';
import { stampFromJSON } from '../src/stamps';
import { makeLab, runAll, blobs, saveFrame, log, type Lab } from './lab';

export default async function (cfg: { F?: number; k?: number; ds?: number[]; steps?: number }) {
  const N = 192, c = 96, g = { F: cfg.F ?? 0.054, k: cfg.k ?? 0.065 };
  const sol = stampFromJSON(await (await fetch('/lab/out/still-hit/soliton.json')).json());
  const ds = cfg.ds ?? [10, 12, 14, 16, 18, 20, 24, 28];
  const runs: { name: string; lab: Lab }[] = [];
  for (const d of ds) {
    const l = await makeLab(GS_HISTORY_WAVE, N, g);
    l.place(sol, c - d / 2, c); l.place(sol, c + d / 2, c);
    runs.push({ name: `pair d=${d}`, lab: l });
    const r = await makeLab(GS_HISTORY_WAVE, N, g);
    r.place(sol, c, c - d); r.place(sol, c, c); r.place(sol, c, c + d);
    runs.push({ name: `row3 d=${d}`, lab: r });
  }
  const steps = cfg.steps ?? 30000;
  const hist = runs.map(() => [] as string[]);
  for (let t = 0; t < steps; t += 10000) {
    await runAll(runs.map((r) => r.lab), 10000);
    for (const [i, r] of runs.entries()) {
      const bs = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2).sort((a, b) => a.x + a.y - b.x - b.y);
      const gaps = bs.slice(1).map((b, j) => Math.hypot(b.x - bs[j].x, b.y - bs[j].y).toFixed(1));
      hist[i].push(`${bs.length}[${gaps.join(',')}]`);
    }
  }
  for (const [i, r] of runs.entries()) {
    log(`${r.name.padEnd(10)}: ${hist[i].join('  ')}`);
    await saveFrame(`${r.name.replace(/\W+/g, '_')}.png`, r.lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 1, caption: r.name });
  }
}
