// Glider search over Meta Gray-Scott, every parameter free but the timestep:
// half the samples random over the whole space (base F, k, D_a, D_b too), half
// mutations of the glider finds from meta-search2 (#47, #43). After a warm-up,
// spots of b are tracked across closely spaced snapshots (nearest match, on the
// torus); a glider is a spot tracked the whole window that moves steadily and
// straight. Scored on the number of gliders; runs that fill with spots or
// stripes score 0.
import * as R from '../src/rule';
import { makeLab, runAll, saveFrame, log, blobs, wrapDelta, type Lab } from './lab';

const FIELDS = ['F', 'k', 'Da', 'Db'];
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

export default async function (cfg: { N?: number; samples?: number; warm?: number; every?: number; snaps?: number; seed?: number; batch?: number; parents?: Record<string, number>[] }) {
  const N = cfg.N ?? 256, samples = cfg.samples ?? 64, warm = cfg.warm ?? 100000, every = cfg.every ?? 500, snaps = cfg.snaps ?? 20, batch = cfg.batch ?? 8;
  const rnd = mulberry32(cfg.seed ?? 11);
  const U = (lo: number, hi: number) => lo + rnd() * (hi - lo);
  const logU = (lo: number, hi: number) => Math.exp(Math.log(lo) + rnd() * (Math.log(hi) - Math.log(lo)));
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const base = R.defaultGlobals(R.META_GS);
  const parents = cfg.parents ?? [];
  const specs = Array.from({ length: samples }, (_, n) => {
    let set: Record<string, number>;
    let desc: string;
    if (n % 2 === 0 || !parents.length) {
      const Da = U(0.4, 1.0);
      set = { F: U(0.01, 0.08), k: U(0.04, 0.07), D_a: Da, D_b: Da * U(0.3, 0.7), F_forget: rnd() < 0.3 ? 0 : U(0, 2e-4), F_ref: logU(0.05, 1) };
      for (const X of FIELDS) {
        set[`${X}_gain`] = rnd() < 0.15 ? 0 : (rnd() < 0.6 ? 1 : -1) * REF[X] * logU(0.05, 3);
        set[`${X}_mem`] = logU(2000, 300000);
        set[`${X}_reach`] = logU(0.5, 40);
        set[`${X}_diff`] = U(-1, 1.5);
      }
      desc = 'random';
    } else {
      const pi = Math.floor(rnd() * parents.length), p = { ...base, ...parents[pi] };
      set = {};
      for (const [k, v] of Object.entries(p)) {
        if (k === 'timestep') continue;
        set[k] = k.endsWith('_diff') ? v + 0.2 * gauss() : ['F', 'k', 'D_a', 'D_b'].includes(k) ? v * Math.exp(0.05 * gauss()) : v * Math.exp(0.3 * gauss());
      }
      desc = `mutant of parent ${pi}`;
    }
    return { n, set, desc };
  });
  type Track = { pts: [number, number][]; area: number };
  const results: { n: number; desc: string; score: number; gliders: number; speed: number; spots: number; fill: number; set: Record<string, number> }[] = [];
  for (let b0 = 0; b0 < samples; b0 += batch) {
    const group = specs.slice(b0, b0 + batch);
    const labs: Lab[] = [];
    for (const s of group) labs.push(await makeLab(R.META_GS, N, s.set, 'initial'));
    const S = labs[0].layout.S;
    await runAll(labs, warm);
    const tracks: Track[][] = group.map(() => []);
    const fills = group.map(() => 0), counts = group.map(() => 0), bad = group.map(() => false);
    for (let k = 0; k < snaps; k++) {
      if (k) await runAll(labs, every);
      for (let i = 0; i < labs.length; i++) {
        const { state } = await labs[i].read();
        let on = 0;
        for (let c = 0; c < N * N; c++) { const v = state[c * S * 4 + 1]; if (!Number.isFinite(v)) bad[i] = true; else if (v > 0.2) on++; }
        fills[i] = on / (N * N);
        const bl = bad[i] ? [] : blobs(state, N, S, 1, 0.2, 4).filter((b) => b.area < 400);
        counts[i] = bl.length;
        if (k === 0) { tracks[i] = bl.map((b) => ({ pts: [[b.x, b.y]], area: b.area })); continue; }
        // extend each live track with the nearest unclaimed blob within 8 cells
        const used = new Set<number>();
        for (const t of tracks[i]) {
          if (t.pts.length !== k) continue;
          const [x, y] = t.pts[k - 1];
          let best = -1, bd = 8;
          bl.forEach((b, j) => {
            if (used.has(j)) return;
            const d = Math.hypot(wrapDelta(x, b.x, N), wrapDelta(y, b.y, N));
            if (d < bd) { bd = d; best = j; }
          });
          if (best >= 0) { used.add(best); t.pts.push([bl[best].x, bl[best].y]); }
        }
      }
    }
    for (let i = 0; i < labs.length; i++) {
      const s = group[i];
      let gl = 0, sp = 0;
      for (const t of tracks[i]) {
        if (t.pts.length !== snaps) continue;
        let L = 0, dx = 0, dy = 0;
        for (let k = 1; k < snaps; k++) {
          const ex = wrapDelta(t.pts[k - 1][0], t.pts[k][0], N), ey = wrapDelta(t.pts[k - 1][1], t.pts[k][1], N);
          L += Math.hypot(ex, ey); dx += ex; dy += ey;
        }
        const D = Math.hypot(dx, dy), speed = (D / ((snaps - 1) * every)) * 1000; // cells per 1000 steps
        if (speed > 0.5 && D / L > 0.85) { gl++; sp += speed; }
      }
      const crowded = counts[i] > 80 || fills[i] > 0.3 || bad[i];
      const score = crowded ? 0 : Math.min(gl, 12) + (gl ? 0.1 * Math.min(10, sp / gl) : 0);
      results.push({ n: s.n, desc: s.desc, score, gliders: gl, speed: gl ? sp / gl : 0, spots: counts[i], fill: fills[i], set: s.set });
      log(`#${s.n} ${s.desc}: ${counts[i]} spots, fill ${fills[i].toFixed(3)}${bad[i] ? ' NaN' : ''}, ${gl} gliders${gl ? ` at ${(sp / gl).toFixed(2)} cells/kstep` : ''} → ${score.toFixed(2)}`);
      if (!bad[i]) await saveFrame(`g${String(s.n).padStart(3, '0')}.png`, labs[i], { ri: 1, lo: 0, hi: 0.8, ti: 4, tlo: 0, thi: 0.3, scale: 1, caption: `#${s.n} ${gl} gliders` });
      labs[i].sim.destroy();
    }
  }
  results.sort((a, b) => b.score - a.score);
  log('--- ranked');
  for (const r of results.slice(0, 20)) log(`${r.score.toFixed(2)}  #${r.n} ${r.desc}  ${r.gliders} gliders @ ${r.speed.toFixed(2)}  spots ${r.spots} fill ${r.fill.toFixed(3)}`);
  return results;
}
