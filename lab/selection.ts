// Gray-Scott Selection: follow which founder traits hold the living b over time.
// Each cell's (P_F, P_k) is binned to the nearest founder; logs the share of
// b-mass per founder (F across, k down) and the trait mean/spread, and saves
// frames tinted by P_F.
import * as R from '../src/rule';
import { makeLab, runAll, log, saveFrame } from './lab';

export default async function (cfg: { N?: number; steps?: number; every?: number; set?: Record<string, number>; tag?: string; frames?: number }) {
  const N = cfg.N ?? 256, steps = cfg.steps ?? 300000, every = cfg.every ?? 30000, tag = cfg.tag ?? 'run';
  const lab = await makeLab(R.GS_SELECTION, N, cfg.set ?? {}, 'initial');
  const S4 = lab.layout.S * 4;
  const frameEvery = cfg.frames ?? 0;
  let f = 0;
  for (let t = 0; t <= steps; t += frameEvery || every) {
    if (t) await runAll([lab], frameEvery || every);
    if (frameEvery) await saveFrame(`${tag}/f${String(f++).padStart(4, '0')}.png`, lab, { ri: 1, lo: 0, hi: 0.5, ti: 4, tlo: 0.011, thi: 0.025, scale: 1, caption: `Gray-Scott Selection  t=${t}  (tint = own feed)` });
    if (t % every) continue;
    const s = (await lab.read()).state;
    const share = new Float64Array(16);
    let w = 0, mf = 0, mk = 0, vf = 0, vk = 0, on = 0, nan = 0;
    for (let c = 0; c < N * N; c++) {
      const b = s[c * S4 + 1], pf = s[c * S4 + 4], pk = s[c * S4 + 5];
      if (!Number.isFinite(b + pf + pk)) { nan++; continue; }
      if (b < 0.15) continue;
      on++; w += b; mf += b * pf; mk += b * pk; vf += b * pf * pf; vk += b * pk * pk;
      const ix = Math.min(3, Math.max(0, Math.round((pf - 0.012) / 0.004))), iy = Math.min(3, Math.max(0, Math.round((pk - 0.051) / 0.0027)));
      share[iy * 4 + ix] += b;
    }
    const F = mf / w, K = mk / w;
    log(`${t}: fill ${(on / N / N).toFixed(3)}  F ${F.toFixed(4)}±${Math.sqrt(Math.max(0, vf / w - F * F)).toFixed(4)}  k ${K.toFixed(4)}±${Math.sqrt(Math.max(0, vk / w - K * K)).toFixed(4)}${nan ? `  NaN ${nan}` : ''}`);
    for (let iy = 0; iy < 4; iy++) log(`   k ${(0.051 + 0.0027 * iy).toFixed(4)}: ${[0, 1, 2, 3].map((ix) => `${String(Math.round((100 * share[iy * 4 + ix]) / w)).padStart(3)}%`).join(' ')}`);
    if (!frameEvery) await saveFrame(`${tag}-${String(t).padStart(7, '0')}.png`, lab, { ri: 1, lo: 0, hi: 0.5, ti: 4, tlo: 0.011, thi: 0.025, scale: 1, caption: `t=${t}` });
  }
}
