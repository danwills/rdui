// Runs a lightning scene headless: node lab/run.mjs _bolt '{"scene":"lightning-1","at":[...]}': the channel's size, how far
// down it reaches, whether it has struck, the field at its edge; frames of light
import * as R from '../src/rule';
import { makeLab, log, saveFrame } from './lab';
const scenes = import.meta.glob('../scenes/*.json', { eager: true, import: 'default' }) as Record<string, any>;
export default async function (cfg: { scene: string; at: number[]; set?: Record<string, number>; every?: number; frame?: string; hi?: number }) {
  const scene = scenes[`../scenes/${cfg.scene}.json`];
  const W = scene.size, base = R.BUILTIN_RULES[+scene.rule.split(':')[1]];
  const lab = await makeLab({ ...base, initial: scene.initial as R.Overlay[] }, W, { ...scene.globals, ...cfg.set }, 'initial');
  const S4 = lab.layout.S * 4, ix = (r: string) => lab.layout.reagents.indexOf(r);
  let t = 0;
  for (const T of cfg.at) {
    await lab.run(T - t); t = T;
    const { state } = await lab.read();
    let n = 0, deep = 0, struck = 0, lit = 0, emax = 0, lmax = 0, tips = 0, tdeep = 0;
    const ti = ix('tip') >= 0 ? ix('tip') : ix('b');
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const b = (y * W + x) * S4;
      if (state[b + ix('c')] > 0.5) { n++; deep = Math.max(deep, y); }
      if (ti >= 0 && state[b + ti] > (ix('tip') >= 0 ? 0.5 : 0.2)) { tips++; tdeep = Math.max(tdeep, y); }
      if (state[b + ix('s')] > 0.5) struck++;
      const l = state[b + ix('light')]; lmax = Math.max(lmax, l); if (l > 0.6) lit++;
      if (state[b + ix('c')] < 0.5) emax = Math.max(emax, 1 - state[b + ix('V')]);
    }
    log(`t=${T} channel ${n} reaches row ${deep}/${W} struck ${struck} lit ${lit} light max ${lmax.toFixed(2)}` + (ti >= 0 ? ` tip cells ${tips} deepest ${tdeep}` : ''));
    if (T % (cfg.every ?? 1e9) === 0) await saveFrame(`${cfg.scene}-${T}.png`, lab, { ri: ix(cfg.frame ?? 'light'), lo: 0, hi: cfg.hi ?? 1, ti: ix(cfg.frame ?? 'light'), tlo: 0, thi: cfg.hi ?? 1, scale: 2, caption: `${cfg.scene} t=${T}` });
  }
}
