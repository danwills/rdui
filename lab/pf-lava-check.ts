// Lava lamp check: runs a Phase-field Bubbles 6 scene and logs, at each checkpoint, the number of bubbles and, in each third
// of the lamp (top, middle, bottom), how many are warm (T > 0.1), cool (T < -0.1) and neutral, by their temperature at
// their centre: whether bubbles rise, cool at the top, sink and warm again.
//   node lab/run.mjs pf-lava-check '{"scene":"pf6-lava-lamp-many","at":[50000,100000]}'
import * as R from '../src/rule';
import type { Scene } from '../src/scenes';
import { BrushMode } from '../src/sim';
import { makeLab, log, saveFrame, blobs } from './lab';
export default async function (cfg: { scene: string; at: number[]; set?: Record<string, number>; tag?: string }) {
  const sc: Scene = await (await fetch(`/scenes/${cfg.scene}.json`)).json();
  const rule = R.BUILTIN_RULES[+sc.rule!.split(':')[1]];
  const lab = await makeLab({ ...rule, initial: sc.initial! }, sc.size!, { ...sc.globals, ...cfg.set }, 'initial');
  for (const [x, y, w, h] of sc.walls ?? []) lab.sim.brush({ ax: x, ay: y + h / 2, bx: x + w, by: y + h / 2, radius: h / 2, mode: BrushMode.Wall, strength: 1, hardness: 1, paint: [] });
  const N = lab.N, S4 = lab.layout.S * 4, ix = (n: string) => lab.layout.reagents.indexOf(n);
  let t = 0;
  for (const T of cfg.at) {
    await lab.run(T - t); t = T;
    const s = (await lab.read()).state;
    const bs = blobs(s, N, lab.layout.S, ix('phi'), 0.5, 4);
    // thirds of the lamp, below the wall band along the top row: top, middle, bottom
    const rows = ['top', 'mid', 'bottom'].map((name) => ({ name, warm: 0, cool: 0, neutral: 0 }));
    for (const b of bs) {
      const temp = s[(Math.round(b.y) * N + Math.round(b.x)) * S4 + ix('T')];
      const r = rows[Math.min(2, Math.floor(b.y / (N / 3)))];
      if (temp > 0.1) r.warm++; else if (temp < -0.1) r.cool++; else r.neutral++;
    }
    log(`t=${T}: ${bs.length} bubbles  ` + rows.map((r) => `${r.name}: ${r.warm} warm ${r.cool} cool ${r.neutral} neutral`).join(' | '));
    // dots (under 60 cells) stuck the wrong way round: warm ones in the top third, cool ones in the bottom
    const dot = (b: { x: number; y: number }) => s[(Math.round(b.y) * N + Math.round(b.x)) * S4 + ix('T')];
    const dots = bs.filter((b) => b.area < 60);
    log(`  dots: ${dots.length}, warm at the top ${dots.filter((b) => b.y < N / 3 && dot(b) > 0.1).length}, cool at the bottom ${dots.filter((b) => b.y >= 2 * N / 3 && dot(b) < -0.1).length}`);
    if (cfg.tag) await saveFrame(`${cfg.tag}-${T}.png`, lab, { ri: ix('phi'), lo: 0, hi: 1, ti: ix('T'), tlo: -1, thi: 1, scale: 1, caption: `t=${T}` });
  }
}
