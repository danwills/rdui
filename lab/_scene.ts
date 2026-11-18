// Runs a scene file headless and tracks its bubbles: node lab/run.mjs _scene '{"scene":"momentum-12-hilbert-2","at":[...]}'
import * as R from '../src/rule';
import { makeLab, log, saveFrame } from './lab';
import { blobs } from './_mb';
const scenes = import.meta.glob('../scenes/*.json', { eager: true, import: 'default' }) as Record<string, any>;
export default async function (cfg: { scene: string; at: number[]; set?: Record<string, number>; every?: number }) {
  const scene = scenes[`../scenes/${cfg.scene}.json`];
  const W = scene.size, base = R.BUILTIN_RULES[+scene.rule.split(':')[1]];
  const lab = await makeLab({ ...base, initial: scene.initial as R.Overlay[] }, W, { ...scene.globals, ...cfg.set }, 'initial');
  const S4 = lab.layout.S * 4, ix = (r: string) => lab.layout.reagents.indexOf(r);
  let t = 0;
  for (const T of cfg.at) {
    await lab.run(T - t); t = T;
    const { state } = await lab.read();
    log(`t=${T} ` + blobs(state, S4, W, W, ix).filter((o) => o.area > 20).map((o) => `(${o.x.toFixed(0)},${o.y.toFixed(0)} A${o.area} m${o.m.toFixed(0)} ${(Math.atan2(o.py, o.px) * 180 / Math.PI).toFixed(0)}° |p|${Math.hypot(o.px, o.py).toFixed(0)})`).join(' '));
    if (T % (cfg.every ?? 4000) === 0) await saveFrame(`${cfg.scene}-${T}.png`, lab, { ri: ix('phi'), lo: 0, hi: 1, ti: ix('aim'), tlo: 0, thi: 1, scale: 1, caption: `${cfg.scene} t=${T}` });
  }
}
