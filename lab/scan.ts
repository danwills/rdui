// Run a built-in rule (by name fragment) from its initial state at several
// global settings side by side. Every `every` steps, threshold reagent `view`
// and log the excited area, its bounding box and centroid per run; save each
// run's last frame. Finds e.g. the light level where a BZ fragment keeps size.
import * as R from '../src/rule';
import { makeLab, runAll, saveFrame, log, type Lab } from './lab';

export default async function (cfg: { rule: string; sets: Record<string, number>[]; N?: number; steps?: number; every?: number; view?: string; thr?: number; spectral?: boolean; frames?: number }) {
  const base = R.BUILTIN_RULES.find((r) => r.name.toLowerCase().includes(cfg.rule.toLowerCase()))!;
  const rule = cfg.spectral ? { ...base, laplacian: 'spectral' as const } : base;
  const N = cfg.N ?? 256, v = rule.reagents.indexOf(cfg.view ?? rule.view.reagent), thr = cfg.thr ?? (rule.view.low + rule.view.high) / 2;
  const runs: { g: Record<string, number>; lab: Lab; hist: string[] }[] = [];
  for (const g of cfg.sets) runs.push({ g, lab: await makeLab(rule, N, g, 'initial'), hist: [] });
  const tag = (g: Record<string, number>) => Object.entries(g).map(([k, x]) => `${k}=${x}`).join(' ');
  let f = 0;
  for (let t = cfg.every ?? 2000; t <= (cfg.steps ?? 40000); t += cfg.every ?? 2000) {
    await runAll(runs.map((r) => r.lab), cfg.every ?? 2000);
    for (const [i, r] of runs.entries()) {
      const { state } = await r.lab.read(), S4 = r.lab.layout.S * 4;
      let n = 0, sx = 0, sy = 0, x0 = N, x1 = -1, y0 = N, y1 = -1;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (state[(y * N + x) * S4 + v] > thr) { n++; sx += x; sy += y; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      r.hist.push(n ? `${t / 1000}k:${n}px ${x1 - x0 + 1}×${y1 - y0 + 1} @(${(sx / n).toFixed(0)},${(sy / n).toFixed(0)})` : `${t / 1000}k:—`);
      if (cfg.frames && i < cfg.frames) await saveFrame(`r${i}-f${String(f).padStart(4, '0')}.png`, r.lab, { ri: v, lo: rule.view.low, hi: rule.view.high, ti: rule.view.tint ? rule.reagents.indexOf(rule.view.tint) : undefined, tlo: 0, thi: 1, scale: 1, caption: `${tag(r.g)} t=${t}` });
    }
    f++;
  }
  for (const r of runs) {
    log(`${tag(r.g)}: ${r.hist.join('  ')}`);
    await saveFrame(`${tag(r.g).replace(/[ =]/g, '_')}.png`, r.lab, { ri: v, lo: rule.view.low, hi: rule.view.high, ti: rule.view.tint ? rule.reagents.indexOf(rule.view.tint) : undefined, tlo: 0, thi: 1, scale: 2, caption: tag(r.g) });
    r.lab.sim.destroy();
  }
}
