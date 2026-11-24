// Auto-fit's view of a rule: every `every` steps, each reagent's 1st and 99th percentile as the app's custom palette
// fits them (a strided sample), saved to lab/out/fit-track/<tag>.json as { steps, reagents, ranges: [step][reagent][lo, hi] },
// for trying out ways of smoothing the fit over time.
//   node lab/run.mjs fit-track '{"rule":"MUD_CRACKS_6","N":256,"steps":300000,"every":1000}'
import * as R from '../src/rule';
import { makeLab, log } from './lab';

export default async function (cfg: { rule?: string; N?: number; steps?: number; every?: number; tag?: string; set?: Record<string, number> }) {
  const N = cfg.N ?? 256, every = cfg.every ?? 1000;
  const rule = (R as unknown as Record<string, R.RuleDef>)[cfg.rule ?? 'MUD_CRACKS_6'];
  const lab = await makeLab(rule, N, cfg.set ?? {}, 'initial');
  const S4 = lab.layout.S * 4, ranges: [number, number][][] = [];
  for (let t = 0; t < (cfg.steps ?? 300000); t += every) {
    await lab.run(every);
    const s = (await lab.read()).state;
    ranges.push(rule.reagents.map((_, r) => {
      const v: number[] = [];
      for (let i = 0; i < N * N; i += 7) if (Number.isFinite(s[i * S4 + r])) v.push(s[i * S4 + r]);
      v.sort((p, q) => p - q);
      return [v[Math.floor(v.length * 0.01)], v[Math.floor(v.length * 0.99)]];
    }));
    if (ranges.length % 50 === 0) log(`${t + every}: ${rule.reagents.map((n, r) => `${n} ${ranges.at(-1)![r].map((x) => x.toPrecision(2)).join('..')}`).join('  ')}`);
  }
  await window.__saveText(`${cfg.tag ?? 'fit-track'}.json`, JSON.stringify({ every, reagents: rule.reagents, ranges }));
}
