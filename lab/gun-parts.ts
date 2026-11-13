// Gun parts: a glider (heading 0°) hits a small soliton cluster, rotated by
// several angles, at many offsets. Flag MULTIPLY (≥2 gliders out, cluster
// intact) and REFLECT (1 glider out turned >40°, cluster intact).
import { GS_HISTORY_WAVE } from '../src/rule';
import { makeLab, runAll, blobs, saveFrame, log, STARTERS, type Lab, type Blob } from './lab';

const D = 25, H = (D * Math.sqrt(3)) / 2;
const SHAPES: Record<string, [number, number][]> = {
  pair: [[-D / 2, 0], [D / 2, 0]],
  line3: [[-D, 0], [0, 0], [D, 0]],
  tri: [[0, (-H * 2) / 3], [-D / 2, H / 3], [D / 2, H / 3]],
  square: [[-D / 2, -D / 2], [D / 2, -D / 2], [-D / 2, D / 2], [D / 2, D / 2]],
  vee: [[-D, -D / 2], [0, 0], [-D, D / 2]],
};

export default async function (cfg: { g?: Record<string, number>; shapes?: string[]; angles?: number[]; offsets?: number[]; steps?: number }) {
  const N = 192, c = 96, g = cfg.g ?? { F: 0.052, k: 0.066 };
  const sol = STARTERS('starter-soliton-hw65'), gl = STARTERS('starter-glider-hw65');
  const offs = cfg.offsets ?? Array.from({ length: 23 }, (_, i) => -22 + 2 * i);
  const hits: Record<string, unknown>[] = [];
  for (const name of cfg.shapes ?? Object.keys(SHAPES)) for (const ang of cfg.angles ?? [0, 30, 60, 90]) {
    const a = (ang * Math.PI) / 180;
    const pts = SHAPES[name].map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
    const runs: { off: number; lab: Lab }[] = [];
    for (const off of offs) { const l = await makeLab(GS_HISTORY_WAVE, N, g); for (const [x, y] of pts) await l.place(sol, c + x, c + y); runs.push({ off, lab: l }); }
    await runAll(runs.map((r) => r.lab), 4000);
    const before = await Promise.all(runs.map(async (r) => blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2)));
    const left = Math.min(...pts.map((p) => p[0])) - 45;
    for (const r of runs) await r.lab.place(gl, c + left, c + r.off);
    const steps = cfg.steps ?? 7000;
    await runAll(runs.map((r) => r.lab), steps - 500);
    const mid = await Promise.all(runs.map(async (r) => blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2)));
    await runAll(runs.map((r) => r.lab), 500);
    const line: string[] = [];
    for (const [i, r] of runs.entries()) {
      const after = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2);
      const stills: Blob[] = [], heads: number[] = [];
      for (const q of after) {
        const p = mid[i].reduce((m, o) => (Math.hypot(o.x - q.x, o.y - q.y) < Math.hypot(m.x - q.x, m.y - q.y) ? o : m), mid[i][0] ?? q);
        if (Math.hypot(q.x - p.x, q.y - p.y) < 2.5) stills.push(q); else heads.push(Math.round((Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI));
      }
      const b0 = before[i];
      const intact = stills.length === b0.length && b0.every((p) => stills.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 4));
      let tag = '.';
      if (intact && heads.length >= 2) tag = `MULTIPLY(${heads.join(',')})`;
      else if (intact && heads.length === 1 && Math.abs(heads[0]) > 40) tag = `REFLECT(${heads[0]})`;
      else if (intact && heads.length === 0) tag = 'eat';
      else if (intact) tag = 'pass';
      else tag = `x${stills.length}/${heads.length}`;
      if (tag.startsWith('MULT') || tag.startsWith('REFL')) {
        hits.push({ name, ang, off: r.off, tag });
        await saveFrame(`${name}-${ang}-o${r.off}.png`, r.lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 2, caption: `${name} ${ang}° off ${r.off}: ${tag}` });
      }
      line.push(`${r.off}:${tag}`);
      r.lab.sim.destroy();
    }
    log(`${name} ${ang}°: ${line.join(' ')}`);
  }
  log(`HITS: ${JSON.stringify(hits)}`);
  return hits;
}
