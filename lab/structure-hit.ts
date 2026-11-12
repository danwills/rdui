// Splitter hunt: fire gliders at small soliton structures across fine offsets
// in a few stable media. Wanted: more gliders out than in, with the structure
// restored (same stills in the same places) — a natural fan-out.
import { GS_HISTORY_WAVE } from '../src/rule';
import type { Stamp } from '../src/stamps';
import { makeLab, runAll, blobs, capture, saveFrame, log, STARTERS, type Lab, type Blob } from './lab';

const N = 192, c = 96;

/** Settle the starter soliton and glider in a medium and re-capture them. */
async function settled(g: Record<string, number>): Promise<{ sol: Stamp; gl: Stamp }> {
  const s = await makeLab(GS_HISTORY_WAVE, N, g);
  s.place(STARTERS('starter-soliton-hw65'), c, c);
  const q = await makeLab(GS_HISTORY_WAVE, N, g);
  q.place(STARTERS('starter-glider-hw65'), 40, c);
  await runAll([s, q], 12000);
  const [sb] = blobs((await s.read()).state, N, s.layout.S, 1, 0.2);
  const [gb] = blobs((await q.read()).state, N, q.layout.S, 1, 0.2);
  const sol = await capture(s, sb.x, sb.y, 28, 28, 'sol', 'sol');
  const gl = await capture(q, gb.x - 2, gb.y, 24, 24, 'gl', 'gl');
  s.sim.destroy(); q.sim.destroy();
  return { sol, gl };
}

const STRUCTS: Record<string, [number, number][]> = {
  single: [[0, 0]],
  ...Object.fromEntries([16, 20].flatMap((d) => [0, 30, 60, 90, 120, 150].map((a) => {
    const r = (a * Math.PI) / 180;
    return [`pair${d}@${a}`, [[(-d / 2) * Math.cos(r), (-d / 2) * Math.sin(r)], [(d / 2) * Math.cos(r), (d / 2) * Math.sin(r)]]];
  }))),
  tri18: [[0, -10.4], [-9, 5.2], [9, 5.2]],
  tri18r: [[0, 10.4], [-9, -5.2], [9, -5.2]],
};

export default async function (cfg: { media?: Record<string, number>[]; structs?: string[]; offsets?: number[]; steps?: number; batch?: number }) {
  const media = cfg.media ?? [{ F: 0.054, k: 0.065 }, { F: 0.052, k: 0.065 }, { F: 0.05, k: 0.064 }];
  const offsets = cfg.offsets ?? Array.from({ length: 21 }, (_, i) => -20 + 2 * i);
  const names = cfg.structs ?? Object.keys(STRUCTS);
  const steps = cfg.steps ?? 8000, batch = cfg.batch ?? 24;
  const hits: Record<string, unknown>[] = [];
  for (const g of media) {
    const { sol, gl } = await settled(g);
    // only structures that are themselves stable in this medium
    const ok: string[] = [];
    {
      const labs: Lab[] = [];
      for (const n of names) { const l = await makeLab(GS_HISTORY_WAVE, N, g); for (const [x, y] of STRUCTS[n]) l.place(sol, c + x, c + y); labs.push(l); }
      await runAll(labs, 12000);
      for (const [i, n] of names.entries()) {
        const bs = blobs((await labs[i].read()).state, N, labs[i].layout.S, 1, 0.2);
        const stable = bs.length === STRUCTS[n].length && STRUCTS[n].every(([x, y]) => bs.some((b) => Math.hypot(b.x - c - x, b.y - c - y) < 4));
        if (stable) ok.push(n);
        labs[i].sim.destroy();
      }
      log(`F=${g.F} k=${g.k}: stable structures: ${ok.join(' ')}`);
    }
    const jobs = ok.flatMap((n) => offsets.map((off) => ({ n, off })));
    for (let j = 0; j < jobs.length; j += batch) {
      const runs: { n: string; off: number; lab: Lab }[] = [];
      for (const job of jobs.slice(j, j + batch)) {
        const l = await makeLab(GS_HISTORY_WAVE, N, g);
        for (const [x, y] of STRUCTS[job.n]) l.place(sol, c + x, c + y);
        l.place(gl, c - 60, c + job.off);
        runs.push({ ...job, lab: l });
      }
      await runAll(runs.map((r) => r.lab), steps - 600);
      const before = await Promise.all(runs.map(async (r) => blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2)));
      await runAll(runs.map((r) => r.lab), 600);
      for (const [i, r] of runs.entries()) {
        const after = blobs((await r.lab.read()).state, N, r.lab.layout.S, 1, 0.2);
        const movers: number[] = [];
        const stills: Blob[] = [];
        for (const q of after) {
          const p = before[i].reduce((m: Blob, o) => (Math.hypot(o.x - q.x, o.y - q.y) < Math.hypot(m.x - q.x, m.y - q.y) ? o : m), before[i][0] ?? q);
          if (Math.hypot(q.x - p.x, q.y - p.y) < 4) stills.push(q);
          else movers.push(Math.round((Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI));
        }
        const restored = stills.length === STRUCTS[r.n].length && STRUCTS[r.n].every(([x, y]) => stills.some((b) => Math.hypot(b.x - c - x, b.y - c - y) < 4));
        const tag = movers.length >= 2 && restored ? 'SPLIT+RESTORED' : movers.length >= 2 ? 'split' : movers.length === 1 && restored ? (Math.abs(movers[0]) > 15 ? 'deflect' : 'pass') : movers.length === 0 && restored ? 'eat' : movers.length === 0 ? 'absorb' : 'swap';
        const rec = { medium: g, struct: r.n, off: r.off, tag, movers, stills: stills.length };
        if (tag === 'SPLIT+RESTORED' || tag === 'split' || (tag === 'deflect' && Math.abs(movers[0]) > 100)) {
          hits.push(rec);
          log(`  ${r.n} off=${r.off}: ${tag} movers ${movers.map((m) => m + '°').join(',')} stills ${stills.length}`);
          await saveFrame(`k${g.k}F${g.F}-${r.n}-o${r.off}.png`, r.lab, { ri: 1, lo: 0, hi: 0.5, ti: 2, tlo: 0, thi: 0.3, scale: 2, caption: `${r.n} off=${r.off} ${tag}` });
        }
        r.lab.sim.destroy();
      }
    }
  }
  return hits;
}
