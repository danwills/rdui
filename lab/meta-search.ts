// Structured search over metaGrayScott. The 24 raw numbers are re-expressed per
// meta field X (c→F, d→k, e→D_a, f→D_b) as: the sign/size of its effect
// (X_effect × {−1, 0, +1, +2} of a reference size), and its spread: "regional"
// (long memory, reach ~20–40 px, like c/e in Dan's tune) or "local" (imprints,
// reach ~1 px, like d/f). Each sample runs from the rule's generator; scored on
// staying alive (b active, not filling), turnover late in the run (structures
// still moving / being born), and the meta fields staying non-uniform.
import { loadBundled } from '../src/ready';
import { makeLab, runAll, saveFrame, log, type Lab } from './lab';

const FIELDS = [
  // effect param, reference |effect| (offset ~ half the base value at the field's usual level), decay, D
  { x: 'F', eff: 'fEffect', ref: 0.12, decay: 'fDecay', D: 'D_F' },
  { x: 'k', eff: 'kEffect', ref: 0.015, decay: 'kDecay', D: 'D_k' },
  { x: 'Da', eff: 'daEffect', ref: 0.5, decay: 'daDecay', D: 'D_Da' },
  { x: 'Db', eff: 'dbEffect', ref: 0.5, decay: 'dbDecay', D: 'D_Db' },
];
// spreads: regional ≈ Dan's c (F) field, local ≈ Dan's d (k) field
const SPREAD = { regional: { decay: 0.0005, D: 0.02 }, local: { decay: 0.003, D: 0.0002 } };
const LEVELS = [-1, 0, 1, 2];

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default async function (cfg: { N?: number; samples?: number; steps?: number; seed?: number; batch?: number; top?: number }) {
  const N = cfg.N ?? 256, samples = cfg.samples ?? 48, steps = cfg.steps ?? 60000, batch = cfg.batch ?? 8;
  const imp = await loadBundled('metaGrayScott_timeworms');
  const rnd = mulberry32(cfg.seed ?? 1);
  const specs = Array.from({ length: samples }, (_, n) => {
    const set: Record<string, number> = {};
    const desc: string[] = [];
    for (const f of FIELDS) {
      const lv = n === 0 ? Math.sign(imp.rule.params.find((p) => p.name === f.eff)!.value) : LEVELS[Math.floor(rnd() * LEVELS.length)];
      const sp = rnd() < 0.5 ? 'regional' : 'local';
      if (n > 0) {
        set[f.eff] = lv * f.ref;
        set[f.decay] = SPREAD[sp].decay;
        set[f.D] = SPREAD[sp].D;
      }
      desc.push(n === 0 ? `${f.x}:dan` : lv === 0 ? `${f.x}0` : `${f.x}${lv > 0 ? '+' : ''}${lv}${sp[0]}`);
    }
    return { n, set, desc: desc.join(' ') };
  });
  const results: { n: number; desc: string; score: number; alive: number; turnover: number; meta: number; set: Record<string, number> }[] = [];
  for (let b0 = 0; b0 < samples; b0 += batch) {
    const group = specs.slice(b0, b0 + batch);
    const labs: Lab[] = [];
    for (const s of group) labs.push(await makeLab(imp.rule, N, s.set, 'initial'));
    const S4 = labs[0].layout.S * 4;
    const masks: Uint8Array[][] = group.map(() => []);
    const fills: number[][] = group.map(() => []);
    const metaVar: number[] = group.map(() => 0);
    const snaps = 6;
    for (let k = 1; k <= snaps; k++) {
      await runAll(labs, steps / snaps);
      for (let i = 0; i < labs.length; i++) {
        const { state } = await labs[i].read();
        const m = new Uint8Array(N * N);
        let on = 0, bad = 0;
        for (let c = 0; c < N * N; c++) {
          const b = state[c * S4 + 1];
          if (!Number.isFinite(b)) bad++;
          if (b > 0.15) { m[c] = 1; on++; }
        }
        masks[i].push(m);
        fills[i].push(bad ? -1 : on / (N * N));
        if (k === snaps) {
          // non-uniformity of the meta fields: mean over c..f of std/(|mean|+0.05)
          let v = 0;
          for (let r = 2; r < 6; r++) {
            let s = 0, s2 = 0;
            for (let c = 0; c < N * N; c++) { const x = state[c * S4 + r]; s += x; s2 += x * x; }
            const mu = s / (N * N), sd = Math.sqrt(Math.max(0, s2 / (N * N) - mu * mu));
            v += sd / (Math.abs(mu) + 0.05) / 4;
          }
          metaVar[i] = v;
        }
      }
    }
    for (let i = 0; i < labs.length; i++) {
      const s = group[i], f = fills[i];
      const late = f.slice(3);
      const blewUp = f.some((x) => x < 0);
      const alive = !blewUp && late.every((x) => x > 0.003 && x < 0.6) ? 1 : 0;
      // turnover: cells that changed on/off between the last snapshots, relative to the active area
      let ch = 0, act = 0;
      for (let k = 4; k < masks[i].length; k++) {
        const a = masks[i][k - 1], b = masks[i][k];
        for (let c = 0; c < N * N; c++) { ch += a[c] ^ b[c]; act += b[c]; }
      }
      const turnover = act ? Math.min(2, ch / act) : 0;
      const score = alive * (turnover + 0.5 * Math.min(1, metaVar[i] || 0));
      results.push({ n: s.n, desc: s.desc, score, alive, turnover, meta: metaVar[i], set: s.set });
      log(`#${s.n} ${s.desc}  fill ${f.map((x) => x.toFixed(3)).join(' ')}  turn ${turnover.toFixed(2)} meta ${metaVar[i].toFixed(2)} → ${score.toFixed(2)}`);
      if (!blewUp) await saveFrame(`s${String(s.n).padStart(3, '0')}.png`, labs[i], { ri: 1, lo: 0, hi: 0.8, scale: 1, caption: `#${s.n} ${s.desc} ${score.toFixed(2)}` });
      labs[i].sim.destroy();
    }
  }
  results.sort((a, b) => b.score - a.score);
  log('--- ranked');
  for (const r of results) log(`${r.score.toFixed(2)}  #${r.n} ${r.desc}  turn ${r.turnover.toFixed(2)} meta ${r.meta.toFixed(2)}`);
  return results;
}
