// Straight to wormhood? Seed lines of b (various lengths/widths) in a clean
// fuseWorms field; do they become one worm of that length, and does it move?
// Also reports the wave reagent d's range for choosing a display range.
import { loadBundled } from '../src/ready';
import { makeLab, runAll, blobs, saveFrame, log, type Lab } from './lab';

export default async function (cfg: { pattern?: string; g?: Record<string, number>; lengths?: number[]; widths?: number[]; steps?: number }) {
  const N = 256, c = 128;
  const rule = (await loadBundled(cfg.pattern ?? 'grayscott-historyWave_fuseWorms')).rule;
  const jobs = (cfg.widths ?? [2, 4]).flatMap((w) => (cfg.lengths ?? [10, 20, 40, 80]).map((L) => ({ L, w })));
  const runs: { L: number; w: number; lab: Lab; hist: string[] }[] = [];
  for (const j of jobs) {
    const l = await makeLab(rule, N, cfg.g ?? {});
    const x0 = Math.round(c - j.L / 2), y0 = Math.round(c - j.w / 2);
    const { state } = await l.sim.readRegion(x0, y0, j.L, j.w);
    const S4 = l.layout.S * 4, ia = l.layout.reagents.indexOf('a'), ib = l.layout.reagents.indexOf('b');
    for (let i = 0; i < j.L * j.w; i++) { state[i * S4 + ia] = 0.5; state[i * S4 + ib] = 0.4; }
    l.sim.writeRegion(x0, y0, j.L, j.w, undefined, state);
    runs.push({ ...j, lab: l, hist: [] });
  }
  const steps = cfg.steps ?? 30000;
  let prev = runs.map(() => ({ x: c, y: c }));
  for (let t = 0; t < steps; t += steps / 6) {
    await runAll(runs.map((r) => r.lab), steps / 6);
    for (const [i, r] of runs.entries()) {
      const bs = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2).sort((a, b) => b.area - a.area);
      const b = bs[0];
      const mv = b ? Math.hypot(b.x - prev[i].x, b.y - prev[i].y) : 0;
      if (b) prev[i] = b;
      r.hist.push(b ? `${bs.length}:a${b.area}/e${b.elong.toFixed(1)}${mv > 3 ? `→${((mv / (steps / 6)) * 1000).toFixed(1)}` : ''}` : '0');
    }
  }
  for (const r of runs) {
    log(`line ${r.L}×${r.w}: ${r.hist.join('  ')}`);
    await saveFrame(`line${r.L}x${r.w}.png`, r.lab, { ri: 1, lo: 0, hi: 0.5, ti: 3, tlo: 0.3, thi: 0.44, scale: 2, caption: `line ${r.L}×${r.w}` });
  }
  // wave reagent range in a soup
  const soup = await makeLab(rule, N, cfg.g ?? {}, 'initial');
  await soup.run(20000);
  const { state } = await soup.read();
  const id = soup.layout.reagents.indexOf('d');
  const ds = Array.from({ length: N * N }, (_, i) => state[i * soup.layout.S * 4 + id]).sort((a, b) => a - b);
  const q = (p: number) => ds[Math.floor(p * (ds.length - 1))].toFixed(4);
  log(`wave d in a soup: 1% ${q(0.01)}  10% ${q(0.1)}  50% ${q(0.5)}  90% ${q(0.9)}  99% ${q(0.99)}`);
}
