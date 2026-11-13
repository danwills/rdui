// Glider loop: four copies of the two-reflector 90° turn, each rotated 90°
// from the last (an exact grid symmetry). The turn takes lane y = A.y − 4,
// heading 0°, to the vertical line x = A.x + 118.5, so corner i+1's A sits
// 114.5 px across and L px along from corner i's. Scan L (the arrival phase).
import { GS_HISTORY_WAVE } from '../src/rule';
import { makeLab, runAll, blobs, log, saveFrame, STARTERS, HW_STD, type Lab } from './lab';
import { clusterPts } from './reflect-ring';

const rot = ([x, y]: number[], q: number) => { for (let i = 0; i < q; i++) [x, y] = [-y, x]; return [x, y]; };
const B_REL = [123.1, 156.2];

export function corners(L: number, cx: number, cy: number, n = 4, across = 114.5, bLater = 70, bFirst = bLater) {
  // corner i's A, relative to corner 0's A, before centring
  const As: number[][] = [[0, 0]];
  for (let i = 1; i < 4; i++) { const step = rot([L, -across], i); As.push([As[i - 1][0] + step[0], As[i - 1][1] + step[1]]); }
  const mx = (Math.min(...As.map((a) => a[0])) + Math.max(...As.map((a) => a[0]))) / 2, my = (Math.min(...As.map((a) => a[1])) + Math.max(...As.map((a) => a[1]))) / 2;
  // Stamps are resampled bilinearly at fractional positions, so put corner 0's
  // A on whole pixels (as in loop-trace) and rotate every point about a centre
  // on the pixel lattice: then all four corners are exact grid rotations.
  const A0 = [Math.round(cx - mx), Math.round(cy - my)], C = [A0[0] + mx, A0[1] + my];
  if (!Number.isInteger(2 * C[0]) || !Number.isInteger(2 * C[1])) throw new Error(`loop centre ${C} is off the pixel lattice: use whole L and across`);
  // Corner 0 gets a freshly stamped glider; later corners get a travelled one,
  // which turns a little less, so their B can be steeper (bLater).
  const base = (bAng: number) => [
    ...clusterPts('line3', 30).map((p) => [A0[0] + p[0], A0[1] + p[1]]),
    ...clusterPts('line3', bAng).map((p) => [A0[0] + B_REL[0] + p[0], A0[1] + B_REL[1] + p[1]]),
  ];
  const pts: number[][] = [], rots: number[] = [];
  for (let i = 0; i < n; i++) for (const p of base(i ? bLater : bFirst)) { const q = rot([p[0] - C[0], p[1] - C[1]], i); pts.push([C[0] + q[0], C[1] + q[1]]); rots.push(i); }
  return { pts, rots, A0, glider: [A0[0] + Math.min(...clusterPts('line3', 30).map((p) => p[0])) - 45, A0[1] - 4] };
}

export default async function (cfg: { Ls?: number[]; n?: number; N?: number; steps?: number; across?: number[]; bLater?: number[]; runIn?: number[] }) {
  const N = cfg.N ?? 768;
  const jobs = (cfg.Ls ?? [441]).flatMap((L) => (cfg.across ?? [115]).flatMap((ac) => (cfg.bLater ?? [70]).flatMap((bl) => (cfg.runIn ?? [0]).map((ri) => ({ L, ac, bl, ri })))));
  const runs: { L: number; ac: number; bl: number; ri: number; lab: Lab; c: ReturnType<typeof corners> }[] = [];
  for (const { L, ac, bl, ri } of jobs) {
    const l = await makeLab(GS_HISTORY_WAVE, N, HW_STD);
    const c = corners(L, N / 2, N / 2, cfg.n ?? 4, ac, bl);
    for (const [j, [x, y]] of c.pts.entries()) await l.place(STARTERS('starter-soliton-hw65'), x, y, { rot: c.rots[j] });
    runs.push({ L, ac, bl, ri, lab: l, c });
  }
  await runAll(runs.map((r) => r.lab), 4000);
  for (const r of runs) await r.lab.place(STARTERS('starter-glider-hw65'), r.c.glider[0] - r.ri, r.c.glider[1]);
  const T = cfg.steps ?? 80000, chunk = 2000;
  const trails = runs.map(() => [] as number[][]);
  for (let t = chunk; t <= T; t += chunk) {
    await runAll(runs.map((r) => r.lab), chunk);
    for (const [i, r] of runs.entries()) {
      const bs = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2).filter((b) => !r.c.pts.some(([x, y]) => Math.hypot(b.x - x, b.y - y) < 6));
      trails[i].push(bs.length === 1 ? [t, bs[0].x, bs[0].y] : [t, NaN, bs.length]);
    }
  }
  const out = [];
  for (const [i, r] of runs.entries()) {
    const after = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2);
    const intact = r.c.pts.filter(([x, y]) => after.some((q) => Math.hypot(q.x - x, q.y - y) < 5)).length;
    // headings between successive glider sightings, collapsed into legs
    const legs: string[] = [];
    const tr = trails[i];
    for (let j = 1; j < tr.length; j++) {
      if (isNaN(tr[j][1]) || isNaN(tr[j - 1][1])) continue;
      const h = Math.round(((Math.atan2(tr[j][2] - tr[j - 1][2], tr[j][1] - tr[j - 1][1]) * 180) / Math.PI) / 45) * 45;
      const tag = `${h}°`;
      if (Math.hypot(tr[j][2] - tr[j - 1][2], tr[j][1] - tr[j - 1][1]) > 10 && legs.at(-1) !== tag) legs.push(tag);
    }
    const last = tr.at(-1)!;
    log(`L ${r.L} across ${r.ac} bLater ${r.bl} runIn ${r.ri}: ${intact}/${r.c.pts.length} intact; glider legs ${legs.join(' → ') || 'none'}; at end ${isNaN(last[1]) ? `${last[2]} movers` : `(${last[1].toFixed(0)},${last[2].toFixed(0)})`}`);
    out.push({ L: r.L, across: r.ac, bLater: r.bl, runIn: r.ri, intact, legs, trail: tr });
    await saveFrame(`L${r.L}-a${r.ac}-b${r.bl}-r${r.ri}.png`, r.lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 1, caption: `loop L ${r.L}: ${legs.join(' → ')}` });
    r.lab.sim.destroy();
  }
  return out;
}
