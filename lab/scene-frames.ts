// Runs a scene headlessly and saves frames at the given steps: one reagent (ri, lo-hi), or three as red, green and blue
// (rgb), for a look at what the app will show.
//   node lab/run.mjs scene-frames '{"scene":"pf-bubbles-foam","at":[20000],"rgb":["phi1","phi2","phi3"]}'
import * as R from '../src/rule';
import type { Scene } from '../src/scenes';
import { BrushMode } from '../src/sim';
import { makeLab, log, saveFrame, blobs } from './lab';
export default async function (cfg: { scene: string; at: number[]; ri?: string; lo?: number; hi?: number; rgb?: [string, string, string]; count?: string; ti?: string; tlo?: number; thi?: number; set?: Record<string, number> }) {
  const sc: Scene = await (await fetch(`/scenes/${cfg.scene}.json`)).json();
  const rule = R.BUILTIN_RULES[+sc.rule!.split(':')[1]];
  const lab = await makeLab({ ...rule, initial: sc.initial! }, sc.size!, { ...sc.globals, ...cfg.set }, 'initial');
  const ix = (n: string) => lab.layout.reagents.indexOf(n);
  // the scene's walls, drawn as the app draws them
  for (const [x, y, w, h] of sc.walls ?? []) lab.sim.brush({ ax: x, ay: y + h / 2, bx: x + w, by: y + h / 2, radius: h / 2, mode: BrushMode.Wall, strength: 1, hardness: 1, paint: [] });
  if (sc.walls?.length) {
    const { params } = await lab.read();
    let n = 0;
    for (let i = 0; i < lab.N * lab.N; i++) if (params[i * lab.layout.P * 4] > 0.5) n++;
    log(`${n} wall cells`);
  }
  let t = 0;
  for (const T of cfg.at) {
    await lab.run(T - t); t = T;
    if (cfg.count) log(`t=${T}: ${blobs((await lab.read()).state, lab.N, lab.layout.S, ix(cfg.count), 0.5, 4).length} islands of ${cfg.count}`);
    await saveFrame(`${cfg.scene}-${T}.png`, lab, { ri: ix(cfg.ri ?? rule.reagents[0]), lo: cfg.lo ?? 0, hi: cfg.hi ?? 1, rgb: cfg.rgb?.map(ix) as [number, number, number] | undefined, ti: cfg.ti ? ix(cfg.ti) : undefined, tlo: cfg.tlo, thi: cfg.thi, scale: 1, caption: `t=${T}` });
  }
  log(`${cfg.scene} done`);
}
