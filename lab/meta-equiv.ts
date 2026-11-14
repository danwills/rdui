// Check META_GS (meta controls) against Dan's raw metaGrayScott from one shared start.
import { loadBundled } from '../src/ready';
import * as R from '../src/rule';
import { makeLab, runAll, log } from './lab';
import { metaFromRaw } from './meta';

export default async function (cfg: { N?: number; steps?: number[]; set?: Record<string, number> }) {
  const N = cfg.N ?? 256;
  const imp = await loadBundled('metaGrayScott_timeworms');
  const raw = { ...R.defaultGlobals(imp.rule), ...(cfg.set ?? {}) };
  const meta = metaFromRaw(raw);
  log('meta', Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, +v.toPrecision(4)])));
  const A = await makeLab(imp.rule, N, raw, 'initial');
  const B = await makeLab(R.META_GS, N, meta, 'initial');
  const a = await A.read(), b = await B.read();
  A.sim.load(b.state.slice(), a.params);
  const S4 = A.layout.S * 4;
  let t = 0;
  for (const until of cfg.steps ?? [1000, 5000, 20000]) {
    await runAll([A, B], until - t);
    t = until;
    const x = (await A.read()).state, y = (await B.read()).state;
    const diff = [0, 1, 2, 3, 4, 5].map((k) => {
      let m = 0, mx = 0;
      for (let i = 0; i < N * N; i++) { m = Math.max(m, Math.abs(x[i * S4 + k] * (k > 1 ? raw[['fEffect', 'kEffect', 'daEffect', 'dbEffect'][k - 2]] : 1) - y[i * S4 + k])); mx = Math.max(mx, Math.abs(y[i * S4 + k])); }
      return `${['a', 'b', 'dF', 'dk', 'dDa', 'dDb'][k]} ${m.toExponential(1)}/${mx.toFixed(3)}`;
    });
    log(t, diff.join(' | '));
  }
}
