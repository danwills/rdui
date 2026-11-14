// Heredity test for Gray-Scott Lineages: four painted circles, each a different
// Gray-Scott behaviour (spots, worms, maze, curly), seeded at the centre so each
// founds its own lineage. Logs which lineage (nearest founder trait) holds each
// circle and the ground between over time, and saves frames of b tinted by each
// spot's own feed. heredityInitial() is also the scene's opening.
import * as R from '../src/rule';
import { makeLab, runAll, log, saveFrame, paintDisk } from './lab';

export const REGIMES: [string, number, number, number, number][] = [
  ['spots', 0.0367, 0.0649, 0.27, 0.27], ['worms', 0.058, 0.065, 0.73, 0.27],
  ['maze', 0.029, 0.057, 0.27, 0.73], ['curly', 0.018, 0.051, 0.73, 0.73],
];
const R_CIRCLE = 0.17, R_SEED = 0.012;
const WALL = 0.012, DOOR = 0.015;
/** On the ring, facing the middle. */
const doorAt = (cx: number, cy: number) => { const dx = 0.5 - cx, dy = 0.5 - cy, l = Math.hypot(dx, dy), r = R_CIRCLE + WALL / 2; return { cx: cx + (dx / l) * r, cy: cy + (dy / l) * r }; };
const SEEDS = [[0, 0], [0.07, 0.02], [-0.06, 0.05], [-0.03, -0.07], [0.04, -0.06], [0.02, 0.09]];

export const heredityInitial = (only = [0, 1, 2, 3], species = false): R.Overlay[] => [
  { chem: 'a', op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'everywhere' } },
  ...REGIMES.flatMap(([, F, k, cx, cy]): R.Overlay[] => [
    // a closed wall ring, so each lineage fills its circle undisturbed (open doors with Unwall)
    { chem: 'wall', op: 'overwrite', fill: { type: 'constant', value: 1 }, shape: { type: 'circle', cx, cy, r: R_CIRCLE + WALL } },
    { chem: 'wall', op: 'overwrite', fill: { type: 'constant', value: 0 }, shape: { type: 'circle', cx, cy, r: R_CIRCLE } },
    { chem: 'F', op: 'overwrite', fill: { type: 'constant', value: F }, shape: { type: 'circle', cx, cy, r: R_CIRCLE } },
    ...(species ? [] : [{ chem: 'k', op: 'overwrite', fill: { type: 'constant', value: k }, shape: { type: 'circle', cx, cy, r: R_CIRCLE } } as R.Overlay]),
    // small seed spots (a wide uniform seed dies in the spots and worms regimes)
    ...SEEDS.filter(() => only.includes(REGIMES.findIndex((g) => g[3] === cx && g[4] === cy))).flatMap(([dx, dy]): R.Overlay[] => [
      { chem: 'a', op: 'overwrite', fill: { type: 'constant', value: 0.5 }, shape: { type: 'circle', cx: cx + dx, cy: cy + dy, r: R_SEED } },
      { chem: species ? `b${REGIMES.findIndex((g) => g[3] === cx && g[4] === cy) + 1}` : 'b', op: 'overwrite', fill: { type: 'constant', value: 0.3 }, shape: { type: 'circle', cx: cx + dx, cy: cy + dy, r: R_SEED } },
    ]),
  ]),
];

export default async function (cfg: { species?: boolean; open?: number; only?: number[]; N?: number; steps?: number; every?: number; frames?: number; tag?: string; set?: Record<string, number> }) {
  const N = cfg.N ?? 384, steps = cfg.steps ?? 60000, every = cfg.every ?? 10000, tag = cfg.tag ?? 'run', frameEvery = cfg.frames ?? 0;
  const sp = !!cfg.species, rule = sp ? R.GS_SPECIES : R.GS_LINEAGES;
  const lab = await makeLab({ ...rule, initial: heredityInitial(cfg.only, sp) }, N, sp ? { ...cfg.set } : { F: 0.03, k: 0.06, ...cfg.set }, 'initial');
  const BI = sp ? 5 : 1, FI = sp ? 6 : 5;
  const S4 = lab.layout.S * 4, names = [...REGIMES.map((r) => r[0]), 'between'];
  const regionOf = (x: number, y: number) => { const j = REGIMES.findIndex(([, , , cx, cy]) => Math.hypot((x + 0.5) / N - cx, (y + 0.5) / N - cy) <= R_CIRCLE + WALL); return j < 0 ? 4 : j; };
  const outside = (x: number, y: number) => regionOf(x, y) === 4;
  let f = 0;
  for (let t = 0; t <= steps; t += frameEvery || every) {
    if (t) await runAll([lab], frameEvery || every);
    if (t === cfg.open) for (const [, , , cx, cy] of REGIMES) { const d = doorAt(cx, cy); await paintDisk(lab, d.cx * N, d.cy * N, DOOR * N, { wall: 0 }); }
    if (frameEvery) await saveFrame(`${tag}/f${String(f++).padStart(4, '0')}.png`, lab, { ri: BI, lo: 0, hi: 0.5, ti: FI, tlo: 0.015, thi: 0.06, scale: 2, caption: `spots worms / maze curly   t=${t}   tint = own feed` });
    if (t % every) continue;
    const share = names.map(() => [0, 0, 0, 0]), mean = names.map(() => [0, 0, 0]);
    const { state: s, params: pw } = await lab.read();
    let esc = 0, inWall = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = (y * N + x) * S4, b = s[i + BI];
      if (!(b > 0.15)) continue;
      if (pw[(y * N + x) * lab.layout.P * 4] > 0.5) inWall++; else if (outside(x, y)) esc++;
      const pf = s[i + FI], pk = sp ? 0 : s[i + 6];
      if (sp) for (let j = 0; j < 4; j++) share[regionOf(x, y)][j] += s[i + 1 + j];
      else {
        let best = 0, bd = Infinity;
        REGIMES.forEach(([, F, k], j) => { const d = ((pf - F) / 0.04) ** 2 + ((pk - k) / 0.014) ** 2; if (d < bd) { bd = d; best = j; } });
        share[regionOf(x, y)][best] += b;
      }
      const m = mean[regionOf(x, y)]; m[0] += b; m[1] += b * pf; m[2] += b * pk;
    }
    log(`${t}: b cells in walls ${inWall}, beyond the rings ${esc}`);
    log(`${t}: ` + share.map((sh, q) => { const w = sh.reduce((a, b) => a + b, 0); return `${names[q]}` + (w ? ` (F ${(mean[q][1] / mean[q][0]).toFixed(4)} k ${(mean[q][2] / mean[q][0]).toFixed(4)})` : '') + ': ' + (w ? sh.map((v, j) => `${REGIMES[j][0]} ${Math.round((100 * v) / w)}%`).filter((x) => !x.endsWith(' 0%')).join(' ') : 'empty'); }).join('  |  '));
    if (!frameEvery) await saveFrame(`${tag}-${String(t).padStart(6, '0')}.png`, lab, { ri: BI, lo: 0, hi: 0.5, ti: FI, tlo: 0.015, thi: 0.06, scale: 1, caption: `t=${t}` });
  }
}
