// Runs a scene headlessly and saves frames at the given steps: one reagent (ri, lo-hi), or three as red, green and blue
// (rgb), for a look at what the app will show.
//   node lab/run.mjs scene-frames '{"scene":"pf-bubbles-foam","at":[20000],"rgb":["phi1","phi2","phi3"]}'
import * as R from '../src/rule';
import type { Scene } from '../src/scenes';
import { makeLab, log, saveFrame, blobs } from './lab';
export default async function (cfg: { scene: string; at: number[]; ri?: string; lo?: number; hi?: number; rgb?: [string, string, string]; count?: string }) {
  const sc: Scene = await (await fetch(`/scenes/${cfg.scene}.json`)).json();
  const rule = R.BUILTIN_RULES[+sc.rule!.split(':')[1]];
  const lab = await makeLab({ ...rule, initial: sc.initial! }, sc.size!, sc.globals ?? {}, 'initial');
  const ix = (n: string) => lab.layout.reagents.indexOf(n);
  let t = 0;
  for (const T of cfg.at) {
    await lab.run(T - t); t = T;
    if (cfg.count) log(`t=${T}: ${blobs((await lab.read()).state, lab.N, lab.layout.S, ix(cfg.count), 0.5, 4).length} islands of ${cfg.count}`);
    await saveFrame(`${cfg.scene}-${T}.png`, lab, { ri: ix(cfg.ri ?? rule.reagents[0]), lo: cfg.lo ?? 0, hi: cfg.hi ?? 1, rgb: cfg.rgb?.map(ix) as [number, number, number] | undefined, scale: 1, caption: `t=${T}` });
  }
  log(`${cfg.scene} done`);
}
