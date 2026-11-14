// Dan's raw metaGrayScott vs META_GS settings from one shared start: b fill and mean field offsets over time.
import { loadBundled } from '../src/ready';
import * as R from '../src/rule';
import { makeLab, runAll, log, saveFrame } from './lab';

export default async function (cfg: { N?: number; steps?: number; every?: number; variants: Record<string, number>[] }) {
  const N = cfg.N ?? 256, steps = cfg.steps ?? 80000, every = cfg.every ?? 10000;
  const imp = await loadBundled('metaGrayScott_timeworms');
  const raw = R.defaultGlobals(imp.rule);
  const A = await makeLab(imp.rule, N, raw, 'initial');
  const labs = [A];
  for (const v of cfg.variants) labs.push(await makeLab(R.META_GS, N, v, 'initial'));
  const st = (await labs[1].read()).state;
  A.sim.load(st.slice(), (await A.read()).params);
  for (const l of labs.slice(2)) l.sim.load(st.slice(), (await l.read()).params);
  const S4 = A.layout.S * 4, scale = [1, 1, raw.fEffect, raw.kEffect, raw.daEffect, raw.dbEffect];
  for (let t = every; t <= steps; t += every) {
    await runAll(labs, every);
    const rows = [];
    for (let i = 0; i < labs.length; i++) {
      const s = (await labs[i].read()).state;
      let fill = 0; const mu = [0, 0, 0, 0];
      for (let c = 0; c < N * N; c++) {
        if (s[c * S4 + 1] > 0.15) fill++;
        for (let k = 0; k < 4; k++) mu[k] += s[c * S4 + 2 + k] * (i === 0 ? scale[2 + k] : 1) / (N * N);
      }
      rows.push(`${i === 0 ? 'raw' : 'v' + i} fill ${(fill / N / N).toFixed(3)} dF ${mu[0].toFixed(3)} dk ${mu[1].toFixed(3)} dDa ${mu[2].toFixed(2)} dDb ${mu[3].toFixed(3)}`);
      if (t === steps) await saveFrame(`cmp-${i}.png`, labs[i], { ri: 1, lo: 0, hi: 0.8, scale: 1, caption: i === 0 ? 'raw (Dan)' : `v${i}` });
    }
    log(t, rows.join('  ||  '));
  }
}
