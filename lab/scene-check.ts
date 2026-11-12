// Run a scene file headlessly (paint, stamps, probes) and log probe means.
import * as R from '../src/rule';
import { STARTER_STAMPS } from '../src/stamps';
import { makeLab, saveFrame, log } from './lab';
import type { Scene } from '../src/scenes';

export default async function (cfg: { scene: string; steps: number; every: number; reagent: string; frames?: boolean; tint?: string; tlo?: number; thi?: number }) {
  const sc: Scene = await (await fetch(`/scenes/${cfg.scene}.json`)).json();
  const base = R.BUILTIN_RULES[+sc.rule.split(':')[1]];
  const rule = sc.paintable ? { ...base, paintable: sc.paintable } : base;
  const lab = await makeLab(rule, sc.size ?? 256, sc.globals ?? {});
  for (const p of sc.paint ?? []) await lab.paint(...p.rect, p.values);
  for (const s of sc.stamps ?? []) lab.place(STARTER_STAMPS.find((x) => x.id === s.stamp)!, s.x, s.y, s);
  const ri = lab.layout.reagents.indexOf(cfg.reagent);
  const S4 = lab.layout.S * 4;
  const boxes = (sc.probes ?? []).map((p) => ({ ...p, label: p.name }));
  let n = 0;
  for (let t = 0; t <= cfg.steps; t += cfg.every) {
    if (t) await lab.run(cfg.every);
    const { state } = await lab.read();
    const vals = (sc.probes ?? []).map((p) => {
      let s = 0;
      for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) s += state[(y * lab.N + x) * S4 + ri];
      return `${p.name}=${(s / (p.w * p.h)).toFixed(3)}`;
    });
    log(String(t).padStart(6), vals.join('  '));
    if (cfg.frames) {
      const ti = cfg.tint ? lab.layout.reagents.indexOf(cfg.tint) : undefined;
      await saveFrame(`f${String(n++).padStart(4, '0')}.png`, lab, { ri: lab.layout.reagents.indexOf('b'), lo: 0, hi: 0.5, ti, tlo: cfg.tlo ?? 0, thi: cfg.thi ?? 1, boxes, caption: `${sc.name}  t=${t}  ${vals.join(' ')}`, outline: 'cell' });
    }
  }
}
