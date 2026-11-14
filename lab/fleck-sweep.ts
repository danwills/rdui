// Gray-Scott + c (fleck): which F/k (around the shader's 0.014/0.051 ± its mouse
// range) keep activity going from the rule's initial pattern; mean b and c over time.
import { GS_FLECK, type RuleDef } from '../src/rule';
import { makeLab, runAll, saveFrame, log, type Lab } from './lab';

export default async function (cfg: { N?: number; Fs?: number[]; ks?: number[]; steps?: number; every?: number; g?: Record<string, number>; initial?: RuleDef['initial']; frames?: boolean }) {
  const N = cfg.N ?? 256;
  const rule = cfg.initial ? { ...GS_FLECK, initial: cfg.initial } : GS_FLECK;
  const runs: { lab: Lab; F: number; k: number; hist: string[] }[] = [];
  for (const F of cfg.Fs ?? [0.009, 0.014, 0.019]) for (const k of cfg.ks ?? [0.046, 0.051, 0.056]) {
    runs.push({ lab: await makeLab(rule, N, { ...cfg.g, F, k }, 'initial'), F, k, hist: [] });
  }
  const every = cfg.every ?? 1000;
  for (let t = every; t <= (cfg.steps ?? 6000); t += every) {
    await runAll(runs.map((r) => r.lab), every);
    for (const r of runs) {
      const { state } = await r.lab.read(), S4 = r.lab.layout.S * 4;
      let b = 0, c = 0;
      for (let i = 0; i < N * N; i++) { b += state[i * S4 + 1]; c += state[i * S4 + 2]; }
      r.hist.push(`${(b / N / N).toFixed(3)}/${(c / N / N).toFixed(2)}`);
      if (cfg.frames) await saveFrame(`F${r.F}-k${r.k}-f${String(r.hist.length).padStart(4, '0')}.png`, r.lab, { ri: 0, lo: 0, hi: 1, fleck: 'hsv', scale: 1, caption: `F ${r.F} k ${r.k} t=${t}` });
    }
  }
  for (const r of runs) {
    log(`F ${r.F} k ${r.k}: b/c ${r.hist.join(' ')}`);
    await saveFrame(`F${r.F}-k${r.k}.png`, r.lab, { ri: 0, lo: 0, hi: 1, fleck: 'hsv', scale: 1, caption: `F ${r.F} k ${r.k}` });
    r.lab.sim.destroy();
  }
}
