// Search Gray-Scott Weather: per-field controls as in meta-search2 plus random
// sparse couplings Y_to_X (half of the 16 nonzero, −3…3). Scored on the
// Gray-Scott layer staying alive and changing, the fields changing by
// themselves late in the run (|Δu| between snapshots relative to their spatial
// spread) and staying non-uniform.
import * as R from '../src/rule';
import { makeLab, runAll, saveFrame, log, type Lab } from './lab';

const X4 = ['F', 'k', 'Da', 'Db'];
const REF: Record<string, number> = { F: 0.05, k: 0.01, Da: 0.4, Db: 0.3 }; // offset per unit field, roughly

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default async function (cfg: { N?: number; samples?: number; steps?: number; snaps?: number; seed?: number; batch?: number }) {
  const N = cfg.N ?? 256, samples = cfg.samples ?? 64, steps = cfg.steps ?? 150000, snaps = cfg.snaps ?? 10, batch = cfg.batch ?? 8;
  const rnd = mulberry32(cfg.seed ?? 5);
  const U = (lo: number, hi: number) => lo + rnd() * (hi - lo);
  const logU = (lo: number, hi: number) => Math.exp(Math.log(lo) + rnd() * (Math.log(hi) - Math.log(lo)));
  const specs = Array.from({ length: samples }, (_, n) => {
    const set: Record<string, number> = { F: U(0.02, 0.07), k: U(0.05, 0.067) };
    for (const X of X4) {
      set[`${X}_gain`] = rnd() < 0.15 ? 0 : (rnd() < (X === 'Da' ? 0.85 : 0.6) ? 1 : -1) * REF[X] * logU(0.2, 4);
      set[`${X}_mem`] = logU(1000, 100000);
      set[`${X}_reach`] = logU(0.5, 30);
      set[`${X}_diff`] = U(-1, 1.5);
      for (const Y of X4) set[`${Y}_to_${X}`] = rnd() < 0.5 ? U(-3, 3) : 0;
    }
    return { n, set };
  });
  const results: { n: number; score: number; turn: number; dyn: number; struct: number; fills: number[]; set: Record<string, number> }[] = [];
  for (let b0 = 0; b0 < samples; b0 += batch) {
    const group = specs.slice(b0, b0 + batch);
    const labs: Lab[] = [];
    for (const s of group) labs.push(await makeLab(R.WEATHER_GS, N, s.set, 'initial'));
    const S4 = labs[0].layout.S * 4;
    const prev: (Float32Array | null)[] = group.map(() => null);
    const fills: number[][] = group.map(() => []);
    const turn = group.map(() => 0), dyn = group.map(() => 0), struct = group.map(() => 0), bad = group.map(() => false);
    for (let k = 1; k <= snaps; k++) {
      await runAll(labs, Math.round(steps / snaps));
      for (let i = 0; i < labs.length; i++) {
        const { state } = await labs[i].read();
        let on = 0;
        for (let c = 0; c < N * N; c++) { const v = state[c * S4 + 1]; if (!Number.isFinite(v)) bad[i] = true; else if (v > 0.15) on++; }
        fills[i].push(bad[i] ? -1 : on / (N * N));
        const p = prev[i];
        if (p && k > snaps / 2 && !bad[i]) {
          // Gray-Scott layer turnover (relative to the active area, floored so a few spots can't saturate it)
          let ch = 0, act = 0;
          for (let c = 0; c < N * N; c++) { const x = state[c * S4 + 1] > 0.15, y = p[c * S4 + 1] > 0.15; ch += +(x !== y); act += +x; }
          turn[i] += Math.min(1, ch / (act + 0.02 * N * N)) / (snaps / 2);
          // fields: change between snapshots relative to their spatial spread; spread relative to level
          let dsum = 0, ssum = 0;
          for (let r = 2; r < 6; r++) {
            let s = 0, s2 = 0, dd = 0;
            for (let c = 0; c < N * N; c++) { const x = state[c * S4 + r]; s += x; s2 += x * x; dd += Math.abs(x - p[c * S4 + r]); }
            const mu = s / (N * N), sd = Math.sqrt(Math.max(0, s2 / (N * N) - mu * mu));
            dsum += Math.min(1, dd / (N * N) / (sd + 0.02)) / 4;
            ssum += Math.min(1, sd / (Math.abs(mu) + 0.05)) / 4;
          }
          dyn[i] += dsum / (snaps / 2);
          struct[i] = ssum;
        }
        prev[i] = state.slice();
      }
    }
    for (let i = 0; i < labs.length; i++) {
      const s = group[i], f = fills[i];
      const alive = !bad[i] && f.slice(3).every((x) => x > 0.003 && x < 0.6);
      const score = alive ? turn[i] + dyn[i] + 0.5 * struct[i] : 0;
      results.push({ n: s.n, score, turn: turn[i], dyn: dyn[i], struct: struct[i], fills: f, set: s.set });
      log(`#${s.n} fill ${f.map((x) => x.toFixed(3)).join(' ')}  turn ${turn[i].toFixed(2)} dyn ${dyn[i].toFixed(2)} struct ${struct[i].toFixed(2)} → ${score.toFixed(2)}`);
      if (!bad[i]) {
        await saveFrame(`w${String(s.n).padStart(3, '0')}-b.png`, labs[i], { ri: 1, lo: 0, hi: 0.8, scale: 1, caption: `#${s.n} b ${score.toFixed(2)}` });
        const { state } = await labs[i].read();
        for (const r of [2, 4]) {
          let lo = Infinity, hi = -Infinity;
          for (let c = 0; c < N * N; c++) { lo = Math.min(lo, state[c * S4 + r]); hi = Math.max(hi, state[c * S4 + r]); }
          await saveFrame(`w${String(s.n).padStart(3, '0')}-${R.WEATHER_GS.reagents[r]}.png`, labs[i], { ri: r, lo, hi: hi > lo ? hi : lo + 1, scale: 1, caption: `#${s.n} ${R.WEATHER_GS.reagents[r]} ${lo.toFixed(2)}..${hi.toFixed(2)}` });
        }
      }
      labs[i].sim.destroy();
    }
  }
  results.sort((a, b) => b.score - a.score);
  log('--- ranked');
  for (const r of results.slice(0, 20)) log(`${r.score.toFixed(2)}  #${r.n}  turn ${r.turn.toFixed(2)} dyn ${r.dyn.toFixed(2)} struct ${r.struct.toFixed(2)}  fill ${r.fills.map((x) => x.toFixed(2)).join(' ')}`);
  return results;
}
