// Spiralling soliton pairs in the saturable NLS: two in-phase solitons with
// opposite sideways momentum ±kx at separation sep (cells). Track both peaks and
// log their separation and the pair's rotation angle over time.
import { SATURABLE_NLS, type RuleDef } from '../src/rule';
import { makeLab, runAll, blobs, wrapDelta, log, type Lab } from './lab';

export default async function (cfg: { sets: { sep: number; kx: number; amp?: number; sigma?: number }[]; N?: number; steps?: number; every?: number }) {
  const N = cfg.N ?? 256, labs: Lab[] = [];
  for (const c of cfg.sets) {
    const sol = (cy: number, kx: number) => (['cos', 'sin'] as const).map((part, i) => ({
      chem: i ? 'q' : 'p', op: 'add' as const, fill: { type: 'packet' as const, amp: c.amp ?? 2.2, sigma: c.sigma ?? 7, kx, part }, shape: { type: 'circle' as const, cx: 0.5, cy, r: 0.1 },
    }));
    const rule: RuleDef = { ...SATURABLE_NLS, initial: [...sol(0.5 - c.sep / 2 / N, c.kx), ...sol(0.5 + c.sep / 2 / N, -c.kx)] };
    labs.push(await makeLab(rule, N, {}, 'initial'));
  }
  const hist: string[][] = cfg.sets.map(() => []);
  let ang0: number[] = [], turns = cfg.sets.map(() => 0), prev: number[] = [];
  for (let t = cfg.every ?? 200; t <= (cfg.steps ?? 6000); t += cfg.every ?? 200) {
    await runAll(labs, cfg.every ?? 200);
    for (const [i, lab] of labs.entries()) {
      const st = (await lab.read()).state;
      const bl = blobs(st, N, lab.layout.S, 2, 1).sort((a, b) => b.area - a.area);
      if (bl.length < 2) { hist[i].push(`${t / 1000}k:${bl.length === 1 ? 'fused' : 'gone'}`); continue; }
      const dx = wrapDelta(bl[1].x, bl[0].x, N), dy = wrapDelta(bl[1].y, bl[0].y, N);
      let a = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (prev[i] !== undefined) { let d = a - prev[i]; d = ((d + 540) % 360) - 180; turns[i] += d; }
      prev[i] = a;
      hist[i].push(`${t / 1000}k:${Math.hypot(dx, dy).toFixed(0)}px/${turns[i].toFixed(0)}°`);
    }
  }
  cfg.sets.forEach((c, i) => log(`sep ${c.sep} kx ${c.kx}: ${hist[i].join(' ')}`));
  void ang0;
}
