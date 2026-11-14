// Gray-Scott Selection: which founder traits hold the living b over time, how
// diverse the traits stay, and whether the turnover lasts. Each cell's
// (P_F, P_k) is binned to the nearest founder (R.selectionTrait). With
// cfg.env, each founder square is also painted with its founder's traits
// (the environment the seed bank, trait_eps, carries).
import * as R from '../src/rule';
import { makeLab, runAll, log, saveFrame } from './lab';

export default async function (cfg: { N?: number; steps?: number; every?: number; set?: Record<string, number>; env?: boolean; tag?: string; frames?: number }) {
  const N = cfg.N ?? 256, steps = cfg.steps ?? 300000, every = cfg.every ?? 30000, tag = cfg.tag ?? 'run';
  const lab = await makeLab(R.GS_SELECTION, N, cfg.set ?? {}, 'initial');
  if (cfg.env) for (let ix = 0; ix < 4; ix++) for (let iy = 0; iy < 4; iy++) {
    const [F, k] = R.selectionTrait(ix, iy);
    await lab.paint((ix * N) / 4, (iy * N) / 4, N / 4, N / 4, { F, k });
  }
  const S4 = lab.layout.S * 4;
  const founders = [0, 1, 2, 3].flatMap((iy) => [0, 1, 2, 3].map((ix) => R.selectionTrait(ix, iy)));
  const frameEvery = cfg.frames ?? 0;
  let f = 0, prev: Uint8Array | null = null;
  for (let t = 0; t <= steps; t += frameEvery || every) {
    if (t) await runAll([lab], frameEvery || every);
    if (frameEvery) await saveFrame(`${tag}/f${String(f++).padStart(4, '0')}.png`, lab, { ri: 1, lo: 0, hi: 0.5, ti: 4, tlo: 0.012, thi: 0.022, scale: 1, caption: `Gray-Scott Selection  t=${t}  (tint = own feed)` });
    if (t % every) continue;
    const s = (await lab.read()).state;
    const share = new Float64Array(16), m = new Uint8Array(N * N);
    let w = 0, mf = 0, mk = 0, vf = 0, vk = 0, on = 0, nan = 0;
    for (let c = 0; c < N * N; c++) {
      const b = s[c * S4 + 1], pf = s[c * S4 + 4], pk = s[c * S4 + 5];
      if (!Number.isFinite(b + pf + pk)) { nan++; continue; }
      if (b < 0.15) continue;
      m[c] = 1; on++; w += b; mf += b * pf; mk += b * pk; vf += b * pf * pf; vk += b * pk * pk;
      let best = 0, bd = Infinity;
      founders.forEach(([F, k], j) => { const d = ((pf - F) / 0.008) ** 2 + ((pk - k) / 0.003) ** 2; if (d < bd) { bd = d; best = j; } });
      share[best] += b;
    }
    let turn = NaN;
    if (prev) { let ch = 0; for (let c = 0; c < N * N; c++) ch += m[c] ^ prev[c]; turn = ch / (on + 0.02 * N * N); }
    prev = m;
    const F = mf / w, K = mk / w, kinds = [...share].filter((x) => x / w > 0.02).length;
    log(`${t}: fill ${(on / N / N).toFixed(3)} turnover ${turn.toFixed(2)}  F ${F.toFixed(4)}±${Math.sqrt(Math.max(0, vf / w - F * F)).toFixed(4)}  k ${K.toFixed(4)}±${Math.sqrt(Math.max(0, vk / w - K * K)).toFixed(4)}  lineages >2%: ${kinds}${nan ? `  NaN ${nan}` : ''}`);
    for (let iy = 0; iy < 4; iy++) log(`    ${[0, 1, 2, 3].map((ix) => `${String(Math.round((100 * share[iy * 4 + ix]) / w)).padStart(3)}%`).join(' ')}`);
    if (!frameEvery) await saveFrame(`${tag}-${String(t).padStart(7, '0')}.png`, lab, { ri: 1, lo: 0, hi: 0.5, ti: 4, tlo: 0.012, thi: 0.022, scale: 1, caption: `${tag} t=${t}` });
  }
}
