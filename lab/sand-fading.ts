// node lab/run.mjs sand-fading '{"rule":"SAND_DUNES_FADING","steps":60000}'
// Dunes that fade: over a long run, how much of the field is flat (within 0.75 of its local level, Hb as the rule
// takes it), the relief's spread and tallest, and the sand's mean age; NaN checked; frames of the view.
import * as R from '../src/rule';
import { makeLab, saveFrame, log } from './lab';

export default async function (cfg: { rule?: string; steps?: number; every?: number; globals?: Record<string, number> }) {
  const rule = (R as unknown as Record<string, R.RuleDef>)[cfg.rule ?? 'SAND_DUNES_FADING'];
  const N = 512, total = cfg.steps ?? 60000, every = cfg.every ?? 6000;
  const l = await makeLab(rule, N, cfg.globals ?? {}, 'initial');
  const L = l.layout, S4 = L.S * 4, iH = L.reagents.indexOf('H'), iA = L.reagents.indexOf('age'), iS = L.reagents.indexOf('shade');
  const reach = l.globals.fade_reach ?? 48;
  for (let n = 0; n <= total; n += every) {
    if (n) await l.run(every);
    const { state: s } = await l.read();
    const H = (x: number, y: number) => s[((((y % N) + N) % N) * N + (((x % N) + N) % N)) * S4 + iH];
    let flat = 0, sq = 0, top = 0, age = 0, nan = 0, cnt = 0;
    for (let y = 0; y < N; y += 4) for (let x = 0; x < N; x += 4) {
      const h = H(x, y);
      if (!Number.isFinite(h)) { nan++; continue; }
      let hb = 0;
      for (let k = 0; k < 8; k++) hb += H(Math.round(x + Math.cos(k * Math.PI / 4) * reach), Math.round(y + Math.sin(k * Math.PI / 4) * reach));
      const rel = h - hb / 8;
      cnt++; sq += rel * rel; top = Math.max(top, Math.abs(rel));
      if (Math.abs(rel) < 0.75) flat++;
      if (iA >= 0) age += s[(y * N + x) * S4 + iA];
    }
    log(`${rule.name} step ${n}: flat ${(100 * flat / cnt).toFixed(0)}%, relief ±${Math.sqrt(sq / cnt).toFixed(2)} (most ${top.toFixed(1)}), mean age ${(age / cnt).toFixed(0)}, NaN ${nan}`);
    if (n && n % (2 * every) === 0) await saveFrame(`${cfg.rule ?? 'SAND_DUNES_FADING'}-${n}.png`, l, { ri: iS, lo: 0, hi: 1, scale: 1, caption: `${rule.name} ${n}` });
  }
}
