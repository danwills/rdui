// Mud cracks: dries a layer and logs, every `every` steps, the mean moisture, the largest stress, the share cracked
// (d > 0.5) and the largest damage, saving a frame of d (tinted by m) each time.
//   node lab/run.mjs mud '{"N":256,"steps":40000,"every":4000,"set":{}}'
import * as R from '../src/rule';
import { makeLab, log, saveFrame } from './lab';

export default async function (cfg: { N?: number; steps?: number; every?: number; set?: Record<string, number>; tag?: string }) {
  const N = cfg.N ?? 256;
  const lab = await makeLab(R.MUD_CRACKS, N, cfg.set ?? {}, 'initial');
  const S4 = lab.layout.S * 4, ri = (n: string) => R.MUD_CRACKS.reagents.indexOf(n);
  for (let t = 0; t < (cfg.steps ?? 40000); ) {
    const dt = cfg.every ?? 4000;
    await lab.run(dt); t += dt;
    const s = (await lab.read()).state;
    let m = 0, cracked = 0, dmax = 0, smax = 0, umax = 0, bad = 0;
    for (let i = 0; i < N * N; i++) {
      const c = i * S4, d = s[c + ri('d')];
      if (!Number.isFinite(d) || !Number.isFinite(s[c + ri('ux')])) bad++;
      m += s[c + ri('m')]; if (d > 0.5) cracked++; dmax = Math.max(dmax, d);
      smax = Math.max(smax, Math.abs(s[c + ri('sxx')]), Math.abs(s[c + ri('syy')]));
      umax = Math.max(umax, Math.abs(s[c + ri('ux')]), Math.abs(s[c + ri('uy')]));
    }
    log(`t ${t}: m ${(m / N / N).toFixed(3)} · stress ${smax.toFixed(4)} · |u| ${umax.toFixed(3)} · cracked ${(cracked / N / N * 100).toFixed(1)}% · d max ${dmax.toFixed(2)}${bad ? ` · ${bad} not finite!` : ''}`);
    await saveFrame(`${cfg.tag ?? 'mud'}-${String(t).padStart(6, '0')}`, lab, { ri: ri('d'), lo: 0, hi: 1, ti: ri('m'), tlo: 0, thi: 1, scale: 1 });
    if (bad) break;
  }
}
