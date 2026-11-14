// Long search over Meta Gray-Scott (META_GS, meta controls). Per field X:
// gain (sign × log-uniform size about a reference), mem (log-uniform 2k–200k
// steps), reach (local 0.5–2 or regional 10–40 cells), diff (−1…1.5); plus
// F_forget ∈ {0, 5e-5, 1.5e-4}. Runs long (default 200k steps) with 10
// snapshots so boom-and-bust cycles count: alive = b present and not filling
// at every snapshot after the first three; scored on late turnover, the
// meta fields' non-uniformity, and swings in fill (cycles).
import * as R from '../src/rule';
import { makeLab, runAll, saveFrame, log, type Lab } from './lab';

const REF: Record<string, number> = { F: 1, k: 0.1, Da: 1.5, Db: 1 };

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default async function (cfg: { N?: number; samples?: number; steps?: number; seed?: number; batch?: number; snaps?: number }) {
  const N = cfg.N ?? 256, samples = cfg.samples ?? 64, steps = cfg.steps ?? 200000, batch = cfg.batch ?? 8, snaps = cfg.snaps ?? 10;
  const rnd = mulberry32(cfg.seed ?? 7);
  const logU = (lo: number, hi: number) => Math.exp(Math.log(lo) + rnd() * (Math.log(hi) - Math.log(lo)));
  const specs = Array.from({ length: samples }, (_, n) => {
    const set: Record<string, number> = {};
    const desc: string[] = [];
    if (n > 0) {
      for (const X of ['F', 'k', 'Da', 'Db']) {
        const sign = rnd() < (X === 'Da' ? 0.85 : 0.6) ? 1 : -1; // D_a raised was the sweet spot
        const off = rnd() < 0.15;
        set[`${X}_gain`] = off ? 0 : sign * REF[X] * logU(0.1, 3);
        set[`${X}_mem`] = logU(2000, 200000);
        const local = rnd() < 0.5;
        set[`${X}_reach`] = local ? logU(0.5, 2) : logU(10, 40);
        set[`${X}_diff`] = -1 + rnd() * 2.5;
        desc.push(off ? `${X}0` : `${X}${sign > 0 ? '+' : '−'}${Math.abs(set[`${X}_gain`]).toPrecision(2)}/${(set[`${X}_mem`] / 1000).toFixed(0)}k/${local ? 'l' : 'r'}`);
      }
      set.F_forget = [0, 5e-5, 1.5e-4][Math.floor(rnd() * 3)];
      desc.push(`fg${set.F_forget}`);
    } else desc.push("Dan's tune");
    return { n, set, desc: desc.join(' ') };
  });
  const results: { n: number; desc: string; score: number; turnover: number; meta: number; swing: number; fills: number[]; set: Record<string, number> }[] = [];
  for (let b0 = 0; b0 < samples; b0 += batch) {
    const group = specs.slice(b0, b0 + batch);
    const labs: Lab[] = [];
    for (const s of group) labs.push(await makeLab(R.META_GS, N, { ...s.set }, 'initial'));
    const S4 = labs[0].layout.S * 4;
    const masks: Uint8Array[][] = group.map(() => []);
    const fills: number[][] = group.map(() => []);
    const metaVar: number[] = group.map(() => 0);
    for (let k = 1; k <= snaps; k++) {
      await runAll(labs, Math.round(steps / snaps));
      for (let i = 0; i < labs.length; i++) {
        const { state } = await labs[i].read();
        const m = new Uint8Array(N * N);
        let on = 0, bad = 0;
        for (let c = 0; c < N * N; c++) {
          const b = state[c * S4 + 1];
          if (!Number.isFinite(b)) bad++;
          else if (b > 0.15) { m[c] = 1; on++; }
        }
        masks[i].push(m);
        fills[i].push(bad ? -1 : on / (N * N));
        if (k === snaps) {
          let v = 0;
          for (let r = 2; r < 6; r++) {
            let s = 0, s2 = 0;
            for (let c = 0; c < N * N; c++) { const x = state[c * S4 + r]; s += x; s2 += x * x; }
            const mu = s / (N * N), sd = Math.sqrt(Math.max(0, s2 / (N * N) - mu * mu));
            v += sd / (Math.abs(mu) + 0.05) / 4;
          }
          metaVar[i] = Number.isFinite(v) ? v : 0;
        }
      }
    }
    for (let i = 0; i < labs.length; i++) {
      const s = group[i], f = fills[i];
      const late = f.slice(3);
      const alive = !f.some((x) => x < 0) && late.every((x) => x > 0.003 && x < 0.6);
      let ch = 0, act = 0;
      for (let k = Math.floor(snaps / 2); k < masks[i].length; k++) {
        const a = masks[i][k - 1], b = masks[i][k];
        for (let c = 0; c < N * N; c++) { ch += a[c] ^ b[c]; act += b[c]; }
      }
      const turnover = act ? Math.min(2, ch / act) : 0;
      const swing = late.length ? (Math.max(...late) - Math.min(...late)) / (Math.max(...late) + 1e-6) : 0;
      const score = alive ? turnover + 0.5 * Math.min(1, metaVar[i]) + 0.5 * swing : 0;
      results.push({ n: s.n, desc: s.desc, score, turnover, meta: metaVar[i], swing, fills: f, set: s.set });
      log(`#${s.n} ${s.desc}  fill ${f.map((x) => x.toFixed(3)).join(' ')}  turn ${turnover.toFixed(2)} meta ${metaVar[i].toFixed(2)} swing ${swing.toFixed(2)} → ${score.toFixed(2)}`);
      if (f[f.length - 1] >= 0) await saveFrame(`s${String(s.n).padStart(3, '0')}.png`, labs[i], { ri: 1, lo: 0, hi: 0.8, ti: 4, tlo: 0, thi: 0.6, scale: 1, caption: `#${s.n} ${score.toFixed(2)}` });
      labs[i].sim.destroy();
    }
  }
  results.sort((a, b) => b.score - a.score);
  log('--- ranked');
  for (const r of results) log(`${r.score.toFixed(2)}  #${r.n} ${r.desc}  turn ${r.turnover.toFixed(2)} meta ${r.meta.toFixed(2)} swing ${r.swing.toFixed(2)}`);
  return results;
}
