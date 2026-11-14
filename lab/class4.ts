// Class-4 search: sample random parameter sets of a built-in rule, run each
// from its initial generator, and score how "alive but organised" it is:
// localized structures (blobs) that persist and move, that interact (blob
// count changes), without dying out, filling the field, or turning chaotic.
// Chaos is measured by damage spreading: a twin run with a tiny perturbation;
// class-3 media spread the damage over the whole field fast, class-2 heal it.
// Logs a ranked table and saves the top runs' final frames (rank-NN.png).
import * as R from '../src/rule';
import { makeLab, runAll, saveFrame, blobs, wrapDelta, log, type Lab, type Blob } from './lab';

type Range = [number, number] | [number, number, 'log'];

/** Per-rule defaults: parameter ranges, run length, sample interval. */
const PRESETS: Record<string, { ranges: Record<string, Range>; steps: number; every: number; fixed?: Record<string, number> }> = {
  'gray-scott': { ranges: { F: [0.01, 0.08], k: [0.04, 0.07] }, steps: 20000, every: 1000 },
  neural: {
    ranges: { A: [4, 16], g: [0, 3], kernel_b: [0.5, 1.4], kernel_sigma2: [1.3, 4], theta: [0.5, 2.5], tau_a: [3, 40, 'log'], I: [-0.5, 0.5] },
    steps: 4000, every: 200,
  },
  swift: { ranges: { r: [-0.5, 0.1], b: [0, 2.5], kappa: [0, 1], tau: [1, 50, 'log'] }, steps: 20000, every: 1000 },
  oregonator: { ranges: { phi: [0.04, 0.1], K_h: [0, 3], f: [0.8, 2.5] }, steps: 40000, every: 2000 },
  klein: { ranges: { sg: [0, 1], phi4: [0, 1], mass: [0, 0.5], gamma: [0, 0.01] }, steps: 4000, every: 200 },
};

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Run {
  g: Record<string, number>;
  a: Lab;
  b: Lab;
  prev: Blob[];
  /** per check: excited fraction, blob count, movers, damaged fraction */
  frac: number[];
  count: number[];
  movers: number[];
  damage: number[];
  score?: number;
  why?: string;
}

export default async function (cfg: {
  rule: string; preset?: string; samples?: number; batch?: number; seed?: number; N?: number;
  ranges?: Record<string, Range>; fixed?: Record<string, number>; steps?: number; every?: number;
  view?: string; thr?: number; minMove?: number; top?: number;
}) {
  const rule = R.BUILTIN_RULES.find((r) => r.name.toLowerCase().includes(cfg.rule.toLowerCase()))!;
  const pre = PRESETS[cfg.preset ?? cfg.rule.toLowerCase()] ?? { ranges: {}, steps: 10000, every: 500 };
  const ranges = cfg.ranges ?? pre.ranges, fixed = { ...pre.fixed, ...cfg.fixed };
  const steps = cfg.steps ?? pre.steps, every = cfg.every ?? pre.every;
  const N = cfg.N ?? 128, v = rule.reagents.indexOf(cfg.view ?? rule.view.reagent);
  const lo = rule.view.low, hi = rule.view.high, thr = cfg.thr ?? (lo + hi) / 2, eps = 0.05 * (hi - lo);
  const minMove = cfg.minMove ?? 1.5, rnd = mulberry32(cfg.seed ?? 1);
  const sample = () => {
    const g: Record<string, number> = { ...fixed };
    for (const [k, r] of Object.entries(ranges)) {
      const u = rnd();
      g[k] = r[2] === 'log' ? r[0] * (r[1] / r[0]) ** u : r[0] + u * (r[1] - r[0]);
      g[k] = Number(g[k].toPrecision(3));
    }
    return g;
  };
  const tag = (g: Record<string, number>) => Object.entries(g).map(([k, x]) => `${k}=${x}`).join(' ');

  const done: Run[] = [];
  const total = cfg.samples ?? 32, batch = cfg.batch ?? 8;
  for (let s0 = 0; s0 < total; s0 += batch) {
    const runs: Run[] = [];
    for (let i = s0; i < Math.min(total, s0 + batch); i++) {
      const g = sample();
      const a = await makeLab(rule, N, g, 'initial'), b = await makeLab(rule, N, g, 'rest');
      // the twin: the same start with a small nudge to the view reagent in one 3×3 patch
      const { state } = await a.read(), S4 = a.layout.S * 4;
      for (let y = N / 2 - 1; y <= N / 2 + 1; y++) for (let x = N / 2 - 1; x <= N / 2 + 1; x++) state[(y * N + x) * S4 + v] += 0.02 * (hi - lo);
      b.sim.writeRegion(0, 0, N, N, undefined, state);
      runs.push({ g, a, b, prev: [], frac: [], count: [], movers: [], damage: [] });
    }
    for (let t = every; t <= steps; t += every) {
      await runAll(runs.flatMap((r) => [r.a, r.b]), every);
      for (const r of runs) {
        const A = (await r.a.read()).state, B = (await r.b.read()).state, S4 = r.a.layout.S * 4;
        let on = 0, dmg = 0, bad = false;
        for (let i = 0; i < N * N; i++) {
          const x = A[i * S4 + v];
          if (!Number.isFinite(x)) { bad = true; break; }
          if (x > thr) on++;
          if (Math.abs(x - B[i * S4 + v]) > eps) dmg++;
        }
        if (bad) { r.frac.push(NaN); continue; }
        const bl = blobs(A, N, r.a.layout.S, v, thr);
        // movers: blobs whose nearest previous blob (similar size) is 1.5..every-px away
        let mv = 0;
        for (const p of bl) {
          let best = Infinity;
          for (const q of r.prev) {
            if (q.area < p.area / 2 || q.area > p.area * 2) continue;
            best = Math.min(best, Math.hypot(wrapDelta(q.x, p.x, N), wrapDelta(q.y, p.y, N)));
          }
          if (best >= minMove && best < N / 6) mv++;
        }
        r.prev = bl;
        r.frac.push(on / (N * N)); r.count.push(bl.length); r.movers.push(mv); r.damage.push(dmg / (N * N));
      }
    }
    for (const r of runs) {
      scoreRun(r);
      done.push(r);
      log(`${tag(r.g)}: score ${r.score!.toFixed(2)} (${r.why})`);
    }
    // keep only the top runs' sims, for their frames
    for (const r of runs) r.b.sim.destroy();
    done.sort((p, q) => q.score! - p.score!);
    for (const r of done.splice(cfg.top ?? 12)) r.a.sim.destroy();
  }
  log(`\n=== top ${done.length} for ${rule.name} ===`);
  const ti = rule.view.tint ? rule.reagents.indexOf(rule.view.tint) : undefined;
  for (const [i, r] of done.entries()) {
    log(`#${i + 1} score ${r.score!.toFixed(2)}  ${JSON.stringify(r.g)}  — ${r.why}`);
    await saveFrame(`rank-${String(i + 1).padStart(2, '0')}.png`, r.a, { ri: v, lo, hi, ti, tlo: 0, thi: 1, scale: 2, caption: `#${i + 1} ${r.score!.toFixed(1)} ${tag(r.g)}` });
    r.a.sim.destroy();
  }
}

/**
 * Score from the second half of the run: mean movers (capped), times the
 * blob-count turnover (interactions), times penalties for dying, filling the
 * field, and fast damage spreading.
 */
function scoreRun(r: Run) {
  const n = r.frac.length, h = Math.floor(n / 2);
  if (r.frac.some((x) => Number.isNaN(x))) { r.score = 0; r.why = 'blew up'; return; }
  const last = r.frac[n - 1];
  if (last < 1e-4) { r.score = 0; r.why = 'died'; return; }
  const mean = (a: number[]) => a.slice(h).reduce((s, x) => s + x, 0) / Math.max(1, n - h);
  const movers = mean(r.movers), blobsN = mean(r.count), frac = mean(r.frac), dmg = r.damage[n - 1];
  let turnover = 0;
  for (let i = h + 1; i < n; i++) turnover += Math.abs(r.count[i] - r.count[i - 1]);
  const fill = frac > 0.45 ? 0.1 : frac > 0.3 ? 0.5 : 1;
  // damage spreading: healed (≈0) is fine for gliders; most of the field = chaotic
  const chaos = dmg > 0.5 ? 0.02 : dmg > 0.25 ? 0.3 : 1;
  const mv = Math.min(movers, 15);
  r.score = (0.2 + mv) * (1 + Math.min(turnover, 10) / 10) * fill * chaos * (blobsN >= 1 ? 1 : 0.3);
  r.why = `movers ${movers.toFixed(1)}/${blobsN.toFixed(1)} blobs, turnover ${turnover}, excited ${(100 * frac).toFixed(1)}%, damage ${(100 * dmg).toFixed(1)}%`;
}
