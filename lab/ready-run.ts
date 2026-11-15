// Run a bundled Ready pattern (patterns/ready/<name>.vti) in the lab: is it finite, and is it doing anything?
// Reports each reagent's min / mean / max / spread and NaN count at each check, and optionally saves frames.
//   node lab/run.mjs ready-run '{"name":"orbits","at":[100,1000,5000]}'
import { loadBundled } from '../src/ready';
import { makeLab, log, saveFrame } from './lab';

export default async function (cfg: { name: string; at?: number[]; N?: number; globals?: Record<string, number>; frames?: boolean; lo?: number; hi?: number }) {
  const imp = await loadBundled(cfg.name);
  if (imp.warnings?.length) log(`warnings: ${imp.warnings.join(' | ')}`);
  const N = cfg.N ?? 256;
  const lab = await makeLab(imp.rule, N, cfg.globals ?? {}, 'initial');
  const R = imp.rule.reagents, S4 = lab.layout.S * 4;
  let t = 0;
  for (const T of cfg.at ?? [100, 1000, 5000]) {
    await lab.run(T - t);
    t = T;
    const { state } = await lab.read();
    log(`t=${T}  ` + R.map((name, r) => {
      let lo = Infinity, hi = -Infinity, sum = 0, sq = 0, nan = 0;
      for (let i = 0; i < N * N; i++) { const v = state[i * S4 + r]; if (!Number.isFinite(v)) { nan++; continue; } lo = Math.min(lo, v); hi = Math.max(hi, v); sum += v; sq += v * v; }
      const n = N * N - nan, m = sum / n;
      return `${name}: ${lo.toFixed(3)} / ${m.toFixed(3)} / ${hi.toFixed(3)} sd ${Math.sqrt(Math.max(0, sq / n - m * m)).toFixed(3)}${nan ? ` NaN ${nan}` : ''}`;
    }).join('  |  '));
    if (cfg.frames) await saveFrame(`${cfg.name}-${T}.png`, lab, { ri: 0, lo: cfg.lo ?? -2, hi: cfg.hi ?? 2, scale: 2, caption: `${cfg.name} t=${T}` });
  }
}
