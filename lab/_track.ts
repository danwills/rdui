import * as R from '../src/rule';
import { makeLab, log, saveFrame } from './lab';
import { blobs } from './_mb';
import scene1 from '../scenes/momentum-11-track.json';
import scene2 from '../scenes/momentum-11-track-round.json';
import scene3 from '../scenes/momentum-12-track-ccw.json';
import scene4 from '../scenes/momentum-12-track-corners.json';
export default async function (cfg: { at: number[]; set?: Record<string, number>; round?: boolean; ccw?: boolean; corners?: boolean; rule?: number }) {
  const scene = cfg.corners ? scene4 : cfg.ccw ? scene3 : cfg.round ? scene2 : scene1;
  const W = 256, base = R.BUILTIN_RULES[cfg.rule ?? 50];
  const lab = await makeLab({ ...base, initial: scene.initial as R.Overlay[] }, W, cfg.set ?? {}, 'initial');
  const S4 = lab.layout.S * 4, ix = (r: string) => lab.layout.reagents.indexOf(r);
  let t = 0;
  for (const T of cfg.at) {
    await lab.run(T - t); t = T;
    const { state } = await lab.read();
    log(`t=${T} ` + blobs(state, S4, W, W, ix).map((o) => `(${o.x.toFixed(0)},${o.y.toFixed(0)} A${o.area} m${o.m.toFixed(0)} ${(Math.atan2(o.py, o.px) * 180 / Math.PI).toFixed(0)}° |p|${Math.hypot(o.px, o.py).toFixed(0)})`).join(' '));
    if (T % 2000 === 0) await saveFrame(`track${cfg.corners ? '-corners' : cfg.ccw ? '-ccw' : cfg.round ? '-round' : ''}-${T}.png`, lab, { ri: ix('phi'), lo: 0, hi: 1, ti: ix('aim'), tlo: 0, thi: 1, scale: 1, caption: `track t=${T}` });
  }
}
